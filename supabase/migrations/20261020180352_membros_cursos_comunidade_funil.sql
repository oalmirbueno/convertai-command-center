-- Evolução incremental da biblioteca. Pagamentos permanecem desligados.
BEGIN;
ALTER TABLE public.membros_produtos
 ADD COLUMN tipo_produto text NOT NULL DEFAULT 'curso' CHECK(tipo_produto IN ('curso','material','comunidade')),
 ADD COLUMN landing_url text CHECK(landing_url IS NULL OR landing_url ~ '^https://[^/@[:space:]]+([/][^[:space:]]*)?$'),
 ADD COLUMN landing_embutida boolean NOT NULL DEFAULT false,
 ADD COLUMN checkout_embutido boolean NOT NULL DEFAULT false,
 ADD COLUMN em_venda boolean NOT NULL DEFAULT false,
 ADD COLUMN cta text NOT NULL DEFAULT 'Conhecer oferta' CHECK(length(cta) BETWEEN 1 AND 60),
 ADD COLUMN comunidade_ativa boolean NOT NULL DEFAULT false;
CREATE TABLE public.membros_modulos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
 titulo text NOT NULL CHECK(length(btrim(titulo)) BETWEEN 1 AND 180),
 descricao text NOT NULL DEFAULT '' CHECK(length(descricao)<=4000),
 ordem integer NOT NULL DEFAULT 0,
 estado text NOT NULL DEFAULT 'publicado' CHECK(estado IN ('rascunho','publicado','arquivado')),
 atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id),
 UNIQUE(id,produto_id)
);
CREATE INDEX ON public.membros_modulos(produto_id,ordem);
ALTER TABLE public.membros_materiais
 ADD COLUMN modulo_id uuid,
 ADD COLUMN aula_id uuid,
 ADD COLUMN estado text NOT NULL DEFAULT 'publicado' CHECK(estado IN ('rascunho','publicado','arquivado')),
 ADD CONSTRAINT membros_material_produto_unico UNIQUE(id,produto_id),
 ADD CONSTRAINT membros_material_modulo FOREIGN KEY(modulo_id,produto_id) REFERENCES public.membros_modulos(id,produto_id) ON DELETE RESTRICT,
 ADD CONSTRAINT membros_material_aula FOREIGN KEY(aula_id,produto_id) REFERENCES public.membros_materiais(id,produto_id) ON DELETE RESTRICT,
 ADD CONSTRAINT membros_material_sem_autorreferencia CHECK(aula_id IS NULL OR aula_id<>id);
CREATE INDEX ON public.membros_materiais(modulo_id);
CREATE INDEX ON public.membros_materiais(aula_id);
CREATE FUNCTION public.membros_validar_complemento() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.aula_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.membros_materiais WHERE id=NEW.aula_id AND produto_id=NEW.produto_id AND aula_id IS NULL AND tipo IN ('video','audio','texto')) THEN
  RAISE EXCEPTION 'Selecione uma aula principal do mesmo produto' USING ERRCODE='22023'; END IF;
 IF (NEW.aula_id IS NOT NULL OR NEW.tipo NOT IN ('video','audio','texto')) AND EXISTS(SELECT 1 FROM public.membros_materiais WHERE aula_id=NEW.id) THEN
  RAISE EXCEPTION 'Esta aula possui materiais complementares' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.membros_validar_complemento() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER membros_complemento_valido BEFORE INSERT OR UPDATE ON public.membros_materiais FOR EACH ROW EXECUTE FUNCTION public.membros_validar_complemento();

CREATE FUNCTION public.membros_material_disponivel(_material uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.id=_material AND m.estado='publicado'
 AND (m.modulo_id IS NULL OR EXISTS(SELECT 1 FROM public.membros_modulos mo WHERE mo.id=m.modulo_id AND mo.estado='publicado'))
 AND (m.aula_id IS NULL OR EXISTS(SELECT 1 FROM public.membros_materiais a WHERE a.id=m.aula_id AND a.estado='publicado'
 AND (a.modulo_id IS NULL OR EXISTS(SELECT 1 FROM public.membros_modulos am WHERE am.id=a.modulo_id AND am.estado='publicado')))))
$$;
REVOKE ALL ON FUNCTION public.membros_material_disponivel(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_material_disponivel(uuid) TO authenticated;
ALTER TABLE public.membros_modulos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_modulos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.membros_modulos TO authenticated;
GRANT ALL ON public.membros_modulos TO service_role;
CREATE POLICY modulo_le ON public.membros_modulos FOR SELECT TO authenticated USING(public.membros_admin() OR (estado='publicado' AND public.membros_pode_acessar(produto_id)));
CREATE POLICY modulo_admin ON public.membros_modulos FOR ALL TO authenticated USING(public.membros_admin()) WITH CHECK(public.membros_admin());
CREATE TRIGGER membros_modulo_auditoria BEFORE INSERT OR UPDATE ON public.membros_modulos FOR EACH ROW EXECUTE FUNCTION public.membros_auditar();
CREATE POLICY membros_material_publicado ON public.membros_materiais AS RESTRICTIVE FOR SELECT TO authenticated USING(public.membros_admin() OR public.membros_material_disponivel(id));
CREATE POLICY membros_storage_publicado ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'membros-materiais' OR public.membros_admin() OR EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.arquivo=name AND public.membros_material_disponivel(m.id)));

CREATE FUNCTION public.membros_acervo(_produto uuid,_teste boolean DEFAULT false,_bloqueado boolean DEFAULT false,_previa uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE alvo uuid:=COALESCE(_previa,auth.uid()); administrativo boolean; resultado jsonb;
BEGIN
 IF auth.uid() IS NULL OR _teste IS NULL OR _bloqueado IS NULL OR (_bloqueado AND NOT _teste) OR (_teste AND _previa IS NOT NULL) THEN RAISE EXCEPTION 'Modo inválido' USING ERRCODE='42501'; END IF;
 IF (_teste OR _previa IS NOT NULL) AND NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
 administrativo:=NOT _teste AND public.has_role(alvo,'admin'::public.app_role);
 IF _bloqueado OR (NOT administrativo AND cardinality(public.membros_direitos_membro(_produto,alvo))=0) THEN RAISE EXCEPTION 'Conteúdo não liberado' USING ERRCODE='42501'; END IF;
 WITH visiveis AS MATERIALIZED (SELECT * FROM public.membros_materiais m WHERE m.produto_id=_produto AND (administrativo OR public.membros_material_disponivel(m.id))),
 progresso AS (
  SELECT pr.material_id,pr.posicao,pr.duracao,pr.concluido,pr.atualizado_em FROM public.membros_progresso pr JOIN visiveis m ON m.id=pr.material_id WHERE pr.user_id=alvo AND NOT _teste
  UNION ALL SELECT pr.material_id,pr.posicao,pr.duracao,pr.concluido,pr.atualizado_em FROM public.membros_teste_progresso pr JOIN visiveis m ON m.id=pr.material_id WHERE pr.user_id=alvo AND _teste
 ) SELECT jsonb_build_object('materiais',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordem,m.id) FROM visiveis m),'[]'::jsonb),
 'modulos',COALESCE((SELECT jsonb_agg(to_jsonb(mo) ORDER BY mo.ordem,mo.id) FROM public.membros_modulos mo WHERE mo.produto_id=_produto AND (administrativo OR mo.estado='publicado')),'[]'::jsonb),
 'progresso',COALESCE((SELECT jsonb_agg(to_jsonb(pr)) FROM progresso pr),'[]'::jsonb)) INTO resultado;
 RETURN resultado;
END $$;
REVOKE ALL ON FUNCTION public.membros_acervo(uuid,boolean,boolean,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_acervo(uuid,boolean,boolean,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.membros_teste_materiais(_produto uuid,_bloqueado boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.membros_acervo(_produto,true,_bloqueado,NULL) $$;

CREATE TABLE public.membros_favoritos (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
 teste boolean NOT NULL DEFAULT false, criado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,produto_id,teste)
);
ALTER TABLE public.membros_favoritos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_favoritos FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.membros_minha_lista(_teste boolean DEFAULT false) RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _teste IS NULL OR NOT public.membros_usuario_confirmado() OR (_teste AND NOT public.membros_admin()) THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
 RETURN ARRAY(SELECT produto_id FROM public.membros_favoritos WHERE user_id=auth.uid() AND teste=_teste);
END $$;
CREATE FUNCTION public.membros_favoritar(_produto uuid,_favorito boolean,_teste boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_usuario_confirmado() OR _teste IS NULL OR _favorito IS NULL OR (_teste AND NOT public.membros_admin()) OR NOT EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=_produto AND estado='publicado') THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
 IF _favorito THEN INSERT INTO public.membros_favoritos(user_id,produto_id,teste) VALUES(auth.uid(),_produto,_teste) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.membros_favoritos WHERE user_id=auth.uid() AND produto_id=_produto AND teste=_teste; END IF;
END $$;
REVOKE ALL ON FUNCTION public.membros_minha_lista(boolean),public.membros_favoritar(uuid,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_minha_lista(boolean),public.membros_favoritar(uuid,boolean,boolean) TO authenticated;

CREATE TABLE public.membros_funil (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 produto_origem uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
 produto_destino uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
 momento text NOT NULL DEFAULT 'sempre' CHECK(momento IN ('sempre','concluiu')),
 titulo text NOT NULL DEFAULT '' CHECK(length(titulo)<=180), ordem integer NOT NULL DEFAULT 0,
 ativo boolean NOT NULL DEFAULT true, atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id),
 UNIQUE(produto_origem,produto_destino),CHECK(produto_origem<>produto_destino)
);
ALTER TABLE public.membros_funil ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_funil FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.membros_funil TO authenticated;
CREATE POLICY funil_le ON public.membros_funil FOR SELECT TO authenticated USING(public.membros_admin() OR (ativo AND public.membros_pode_acessar(produto_origem) AND EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=produto_destino AND estado='publicado')));
CREATE POLICY funil_admin ON public.membros_funil FOR ALL TO authenticated USING(public.membros_admin()) WITH CHECK(public.membros_admin());
CREATE TRIGGER membros_funil_auditoria BEFORE INSERT OR UPDATE ON public.membros_funil FOR EACH ROW EXECUTE FUNCTION public.membros_auditar();

CREATE TABLE public.membros_comunidade (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
 autor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 texto text NOT NULL CHECK(length(btrim(texto)) BETWEEN 1 AND 5000),
 resposta_a uuid REFERENCES public.membros_comunidade(id) ON DELETE RESTRICT,
 oculto boolean NOT NULL DEFAULT false,fixado boolean NOT NULL DEFAULT false,
 criado_em timestamptz NOT NULL DEFAULT now(),atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.membros_comunidade(produto_id,criado_em DESC);
CREATE INDEX ON public.membros_comunidade(resposta_a);
ALTER TABLE public.membros_comunidade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_comunidade FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.membros_comunidade_ler(_produto uuid,_teste boolean DEFAULT false,_bloqueado boolean DEFAULT false,_previa uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.membros_acervo(_produto,_teste,_bloqueado,_previa);
 IF NOT EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=_produto AND comunidade_ativa) THEN RAISE EXCEPTION 'Comunidade indisponível' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.fixado DESC,c.criado_em DESC) FROM (
  SELECT c.*,COALESCE(NULLIF(p.full_name,''),'Membro') autor_nome FROM public.membros_comunidade c LEFT JOIN public.profiles p ON p.id=c.autor_id
  WHERE c.produto_id=_produto AND (NOT c.oculto OR (public.membros_admin() AND NOT _teste AND _previa IS NULL)) ORDER BY c.fixado DESC,c.criado_em DESC LIMIT 150
 ) c),'[]'::jsonb);
END $$;
CREATE FUNCTION public.membros_comunidade_salvar(_produto uuid,_texto text,_id uuid DEFAULT NULL,_resposta uuid DEFAULT NULL,_oculto boolean DEFAULT false,_fixado boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE atual public.membros_comunidade; novo uuid;
BEGIN
 IF NOT public.membros_usuario_confirmado() THEN RAISE EXCEPTION 'Confirme seu cadastro' USING ERRCODE='42501'; END IF;
 PERFORM public.membros_acervo(_produto);
 IF NOT EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=_produto AND comunidade_ativa) THEN RAISE EXCEPTION 'Comunidade indisponível' USING ERRCODE='42501'; END IF;
 IF _resposta IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.membros_comunidade WHERE id=_resposta AND produto_id=_produto AND resposta_a IS NULL AND NOT oculto) THEN RAISE EXCEPTION 'Conversa indisponível' USING ERRCODE='22023'; END IF;
 IF _id IS NOT NULL THEN
  SELECT * INTO atual FROM public.membros_comunidade WHERE id=_id AND produto_id=_produto FOR UPDATE;
  IF atual.id IS NULL OR (atual.autor_id<>auth.uid() AND NOT public.membros_admin()) THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
  IF NOT public.membros_admin() AND (_fixado IS DISTINCT FROM atual.fixado OR _oculto IS DISTINCT FROM atual.oculto) THEN RAISE EXCEPTION 'Somente moderação' USING ERRCODE='42501'; END IF;
  UPDATE public.membros_comunidade SET texto=btrim(_texto),oculto=_oculto,fixado=_fixado,atualizado_em=now() WHERE id=_id;
  RETURN _id;
 END IF;
 IF (_oculto OR _fixado) AND NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente moderação' USING ERRCODE='42501'; END IF;
 INSERT INTO public.membros_comunidade(produto_id,autor_id,texto,resposta_a,oculto,fixado) VALUES(_produto,auth.uid(),btrim(_texto),_resposta,_oculto,_fixado) RETURNING id INTO novo;
 RETURN novo;
END $$;
REVOKE ALL ON FUNCTION public.membros_comunidade_ler(uuid,boolean,boolean,uuid),public.membros_comunidade_salvar(uuid,text,uuid,uuid,boolean,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_comunidade_ler(uuid,boolean,boolean,uuid),public.membros_comunidade_salvar(uuid,text,uuid,uuid,boolean,boolean) TO authenticated;

CREATE TABLE public.membros_acessos_historico (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,acesso_id uuid NOT NULL,user_id uuid NOT NULL,produto_id uuid NOT NULL,
 origem text NOT NULL,anterior jsonb,atual jsonb NOT NULL,ator uuid,criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.membros_acessos_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_acessos_historico FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.membros_acessos_historico TO authenticated;
CREATE POLICY historico_admin ON public.membros_acessos_historico FOR SELECT TO authenticated USING(public.membros_admin());
CREATE FUNCTION public.membros_registrar_acesso() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN INSERT INTO public.membros_acessos_historico(acesso_id,user_id,produto_id,origem,anterior,atual,ator)
 VALUES(NEW.id,NEW.user_id,NEW.produto_id,NEW.origem,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'atualizado_por' END,to_jsonb(NEW)-'atualizado_por',auth.uid()); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.membros_registrar_acesso() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER membros_acesso_historico AFTER INSERT OR UPDATE ON public.membros_acessos FOR EACH ROW EXECUTE FUNCTION public.membros_registrar_acesso();
CREATE FUNCTION public.membros_liberar(_usuarios uuid[],_produtos uuid[],_fim timestamptz DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid;p uuid;acesso uuid;quantidade integer:=0;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF COALESCE(cardinality(_usuarios),0) NOT BETWEEN 1 AND 100 OR COALESCE(cardinality(_produtos),0) NOT BETWEEN 1 AND 20 OR (_fim IS NOT NULL AND _fim<=now()) THEN RAISE EXCEPTION 'Seleção ou prazo inválido' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(_usuarios) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=x)) OR EXISTS(SELECT 1 FROM unnest(_produtos) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=x)) THEN RAISE EXCEPTION 'Seleção indisponível' USING ERRCODE='22023'; END IF;
 FOR u IN SELECT DISTINCT unnest(_usuarios) LOOP FOR p IN SELECT DISTINCT unnest(_produtos) LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text||':'||p::text,0));
  SELECT id INTO acesso FROM public.membros_acessos WHERE user_id=u AND produto_id=p AND origem='manual' ORDER BY atualizado_em DESC,id LIMIT 1 FOR UPDATE;
  IF acesso IS NULL THEN INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia,fim) VALUES(u,p,'manual','painel-manual',_fim);
  ELSE UPDATE public.membros_acessos SET inicio=now(),fim=_fim,revogado_em=NULL WHERE id=acesso; END IF;
  quantidade:=quantidade+1;
 END LOOP; END LOOP;
 RETURN quantidade;
END $$;
CREATE FUNCTION public.membros_revogar_manual(_usuario uuid,_produto uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE quantidade integer;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 UPDATE public.membros_acessos SET revogado_em=now() WHERE user_id=_usuario AND produto_id=_produto AND origem='manual' AND revogado_em IS NULL;
 GET DIAGNOSTICS quantidade=ROW_COUNT; RETURN quantidade;
END $$;
REVOKE ALL ON FUNCTION public.membros_liberar(uuid[],uuid[],timestamptz),public.membros_revogar_manual(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_liberar(uuid[],uuid[],timestamptz),public.membros_revogar_manual(uuid,uuid) TO authenticated;

CREATE FUNCTION public.membros_ordenar(_produto uuid,_itens uuid[],_tipo text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF _itens IS NULL OR _produto IS NULL THEN RAISE EXCEPTION 'Lista inválida' USING ERRCODE='22023'; END IF;
 IF _tipo='modulos' THEN
  IF cardinality(_itens)<>(SELECT count(*) FROM public.membros_modulos WHERE produto_id=_produto) OR cardinality(_itens)<>(SELECT count(DISTINCT x) FROM unnest(_itens) x) OR EXISTS(SELECT 1 FROM unnest(_itens) x WHERE NOT EXISTS(SELECT 1 FROM public.membros_modulos WHERE id=x AND produto_id=_produto)) THEN RAISE EXCEPTION 'Lista desatualizada' USING ERRCODE='22023'; END IF;
  UPDATE public.membros_modulos m SET ordem=x.n::int-1 FROM unnest(_itens) WITH ORDINALITY x(id,n) WHERE m.id=x.id AND m.produto_id=_produto;
 ELSIF _tipo='materiais' THEN
  IF cardinality(_itens)<>(SELECT count(*) FROM public.membros_materiais WHERE produto_id=_produto) OR cardinality(_itens)<>(SELECT count(DISTINCT x) FROM unnest(_itens) x) OR EXISTS(SELECT 1 FROM unnest(_itens) x WHERE NOT EXISTS(SELECT 1 FROM public.membros_materiais WHERE id=x AND produto_id=_produto)) THEN RAISE EXCEPTION 'Lista desatualizada' USING ERRCODE='22023'; END IF;
  UPDATE public.membros_materiais m SET ordem=x.n::int-1 FROM unnest(_itens) WITH ORDINALITY x(id,n) WHERE m.id=x.id AND m.produto_id=_produto;
 ELSE RAISE EXCEPTION 'Tipo inválido' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.membros_ordenar(uuid,uuid[],text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_ordenar(uuid,uuid[],text) TO authenticated;

-- Funções compatíveis anteriores são ajustadas abaixo antes do COMMIT.
CREATE FUNCTION public.membros_pessoas(_busca text DEFAULT '',_produto uuid DEFAULT NULL,_estado text DEFAULT '',_pagina integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado jsonb;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF _busca IS NULL OR _pagina IS NULL OR _estado IS NULL OR length(_busca)>180 OR _pagina NOT BETWEEN 0 AND 2000 OR _estado NOT IN ('','comprador','liberado','pendente','encerrado','sem_compra') THEN RAISE EXCEPTION 'Filtro inválido' USING ERRCODE='22023'; END IF;
 WITH base AS (
 SELECT p.id,p.full_name nome,p.email,u.email_confirmed_at IS NOT NULL confirmado,
  (SELECT count(*) FROM public.membros_produtos pr WHERE (_produto IS NULL OR pr.id=_produto) AND pr.estado='publicado' AND cardinality(public.membros_direitos_membro(pr.id,p.id))>0) liberados,
  (SELECT count(*) FROM public.membros_compras c WHERE c.user_id=p.id AND (_produto IS NULL OR c.produto_id=_produto) AND c.estado='pago') compras,
  (SELECT count(*) FROM public.membros_compras c WHERE c.user_id=p.id AND (_produto IS NULL OR c.produto_id=_produto) AND c.estado='pendente') pendentes,
  (SELECT count(*) FROM public.membros_acessos a WHERE a.user_id=p.id AND (_produto IS NULL OR a.produto_id=_produto) AND a.fim<=now() AND a.revogado_em IS NULL) encerrados,
  (SELECT max(pr.atualizado_em) FROM public.membros_progresso pr JOIN public.membros_materiais m ON m.id=pr.material_id WHERE pr.user_id=p.id AND (_produto IS NULL OR m.produto_id=_produto)) ultimo_progresso
 FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id
 WHERE COALESCE(p.full_name,'') ILIKE '%'||_busca||'%' OR COALESCE(p.email,'') ILIKE '%'||_busca||'%'
 ), filtradas AS (
 SELECT *,CASE WHEN liberados>0 THEN 'liberado' WHEN pendentes>0 THEN 'pendente' WHEN encerrados>0 THEN 'encerrado' WHEN compras>0 THEN 'comprador' ELSE 'sem_compra' END situacao FROM base
 ), pagina AS (
 SELECT * FROM filtradas WHERE _estado='' OR (_estado='comprador' AND compras>0) OR (_estado<>'comprador' AND situacao=_estado) ORDER BY nome NULLS LAST,id LIMIT 50 OFFSET _pagina*50
 ) SELECT jsonb_build_object('pessoas',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM pagina p),'[]'::jsonb),
 'total',(SELECT count(*) FROM filtradas WHERE _estado='' OR (_estado='comprador' AND compras>0) OR (_estado<>'comprador' AND situacao=_estado)),
 'resumo',(SELECT jsonb_build_object('pessoas',count(*),'compradores',count(*) FILTER(WHERE compras>0),'liberados',count(*) FILTER(WHERE liberados>0),'encerrados',count(*) FILTER(WHERE situacao='encerrado'),'pendentes',count(*) FILTER(WHERE situacao='pendente')) FROM filtradas)) INTO resultado;
 RETURN resultado;
END $$;
CREATE FUNCTION public.membros_pessoa_detalhe(_usuario uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_usuario) THEN RAISE EXCEPTION 'Pessoa indisponível' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('pessoa',(SELECT jsonb_build_object('id',p.id,'nome',p.full_name,'email',p.email,'confirmado',u.email_confirmed_at IS NOT NULL) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE p.id=_usuario),
 'produtos',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'titulo',p.titulo,'estado',p.estado,'em_venda',p.em_venda,'origens',public.membros_direitos_membro(p.id,_usuario)) ORDER BY p.ordem,p.titulo) FROM public.membros_produtos p),'[]'::jsonb),
 'acessos',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.atualizado_em DESC) FROM public.membros_acessos a WHERE a.user_id=_usuario),'[]'::jsonb),
 'compras',COALESCE((SELECT jsonb_agg(to_jsonb(c)-'comprador_email' ORDER BY c.confirmado_em DESC) FROM public.membros_compras c WHERE c.user_id=_usuario),'[]'::jsonb),
 'historico',COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM (SELECT * FROM public.membros_acessos_historico WHERE user_id=_usuario ORDER BY criado_em DESC LIMIT 50) h),'[]'::jsonb));
END $$;
CREATE FUNCTION public.membros_pessoa_nome(_usuario uuid,_nome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF _nome IS NULL OR length(btrim(_nome)) NOT BETWEEN 1 AND 180 THEN RAISE EXCEPTION 'Nome inválido' USING ERRCODE='22023'; END IF;
 UPDATE public.profiles SET full_name=btrim(_nome) WHERE id=_usuario;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa indisponível' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.membros_pessoas(text,uuid,text,integer),public.membros_pessoa_detalhe(uuid),public.membros_pessoa_nome(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_pessoas(text,uuid,text,integer),public.membros_pessoa_detalhe(uuid),public.membros_pessoa_nome(uuid,text) TO authenticated;

-- COMPATIBILIDADE GERADA: revisão dos contratos já publicados.
CREATE OR REPLACE FUNCTION public.membros_biblioteca(_teste boolean DEFAULT false,_bloqueado boolean DEFAULT false) RETURNS jsonb
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
     WHERE m.produto_id=d.id AND public.membros_material_disponivel(m.id) AND cardinality(d.origens)>0
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
CREATE OR REPLACE FUNCTION public.membros_teste_salvar_progresso(_material uuid,_posicao numeric,_duracao numeric,_concluido boolean,_bloqueado boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE produto uuid;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) OR _bloqueado IS DISTINCT FROM false THEN RAISE EXCEPTION 'Teste indisponível' USING ERRCODE='42501'; END IF;
 SELECT produto_id INTO produto FROM public.membros_materiais WHERE id=_material;
 IF NOT public.membros_material_disponivel(_material) OR produto IS NULL OR cardinality(public.membros_direitos_membro(produto,auth.uid()))=0 THEN RAISE EXCEPTION 'Conteúdo não liberado neste teste' USING ERRCODE='42501'; END IF;
 -- As constraints rejeitam valores nulos, negativos, infinitos e fora do limite.
 INSERT INTO public.membros_teste_progresso(user_id,material_id,posicao,duracao,concluido)
 VALUES(auth.uid(),_material,_posicao,_duracao,_concluido)
 ON CONFLICT(user_id,material_id) DO UPDATE SET posicao=EXCLUDED.posicao,duracao=EXCLUDED.duracao,concluido=EXCLUDED.concluido,atualizado_em=now();
END $$;
CREATE OR REPLACE FUNCTION public.membros_previa(_usuario uuid,_produto uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE resultado jsonb;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=_usuario) THEN RAISE EXCEPTION 'Pessoa indisponível' USING ERRCODE='22023'; END IF;
 IF _produto IS NOT NULL THEN
   RETURN public.membros_acervo(_produto,false,false,_usuario);
 END IF;
 SELECT jsonb_build_object('pessoa',(SELECT jsonb_build_object('id',id,'nome',COALESCE(NULLIF(full_name,''),email)) FROM public.profiles WHERE id=_usuario),
  'produtos',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('origens',public.membros_origens_usuario(p.id,_usuario),
    'progresso',CASE WHEN cardinality(public.membros_origens_usuario(p.id,_usuario))>0 THEN COALESCE((SELECT round(100.0*sum(CASE WHEN pr.concluido THEN 1 WHEN pr.duracao>0 THEN LEAST(pr.posicao/pr.duracao,0.99) ELSE 0 END)/NULLIF(count(*),0)) FROM public.membros_materiais m LEFT JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=_usuario WHERE m.produto_id=p.id AND public.membros_material_disponivel(m.id)),0) ELSE 0 END,
    'ultimo_material',CASE WHEN cardinality(public.membros_origens_usuario(p.id,_usuario))>0 THEN (SELECT m.id FROM public.membros_materiais m JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=_usuario WHERE m.produto_id=p.id AND public.membros_material_disponivel(m.id) AND (pr.posicao>0 OR pr.concluido) ORDER BY pr.atualizado_em DESC LIMIT 1) END
  ) ORDER BY p.ordem,p.titulo) FROM public.membros_produtos p WHERE p.estado='publicado' OR public.has_role(_usuario,'admin'::public.app_role)),'[]'::jsonb),
  'pendentes',COALESCE((SELECT jsonb_agg(jsonb_build_object('produto_id',produto_id,'estado',estado)) FROM public.membros_compras WHERE user_id=_usuario AND estado='pendente'),'[]'::jsonb)) INTO resultado;
 RETURN resultado;
END $$;
CREATE OR REPLACE FUNCTION public.membros_teste_reiniciar() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE quantidade integer;
BEGIN
 IF NOT COALESCE(public.membros_admin(),false) THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 DELETE FROM public.membros_teste_progresso WHERE user_id=auth.uid();
 GET DIAGNOSTICS quantidade=ROW_COUNT;
 DELETE FROM public.membros_favoritos WHERE user_id=auth.uid() AND teste; RETURN quantidade;
END $$;
-- Configuração preparada, sem rotina de liberação ou alteração de pagamentos.
CREATE TABLE public.membros_kiwify_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 integracao_id uuid NOT NULL REFERENCES public.vendas_integracoes(id),
 segredo_id uuid NOT NULL,
 nome text NOT NULL,
 verificado_em timestamptz NOT NULL DEFAULT now(),
 atualizado_por uuid REFERENCES auth.users(id)
);
ALTER TABLE public.membros_kiwify_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_kiwify_config FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.membros_kiwify_estado() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.membros_kiwify_config%ROWTYPE;
BEGIN
 IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MEMBROS_SO_ADMIN'; END IF;
 SELECT * INTO c FROM public.membros_kiwify_config WHERE singleton;
 RETURN jsonb_build_object('configurada',FOUND,'nome',c.nome,'verificado_em',c.verificado_em,'automatico',false);
END $$;
REVOKE ALL ON FUNCTION public.membros_kiwify_estado() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.membros_kiwify_estado() TO authenticated;
CREATE FUNCTION public.membros_kiwify_guardar(_integracao uuid,_credenciais jsonb,_nome text,_ator uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR NOT public.has_role(_ator,'admin') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MEMBROS_SO_SERVIDOR'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vendas_integracoes WHERE id=_integracao AND client_id IS NULL AND gateway='kiwify' AND ativo) THEN RAISE EXCEPTION 'MEMBROS_INTEGRACAO_INVALIDA'; END IF;
 IF _credenciais IS NULL OR jsonb_typeof(_credenciais)<>'object' OR NOT (_credenciais ?& ARRAY['client_id','client_secret','account_id']) OR length(_credenciais::text)>4000 OR length(coalesce(_credenciais->>'client_id','')) NOT BETWEEN 1 AND 1024 OR length(coalesce(_credenciais->>'client_secret','')) NOT BETWEEN 1 AND 1024 OR length(coalesce(_credenciais->>'account_id','')) NOT BETWEEN 1 AND 1024 THEN RAISE EXCEPTION 'MEMBROS_CREDENCIAIS_INVALIDAS'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('membros_kiwify_config'));
 SELECT segredo_id INTO s FROM public.membros_kiwify_config WHERE singleton;
 IF s IS NULL THEN SELECT vault.create_secret(jsonb_build_object('client_id',_credenciais->>'client_id','client_secret',_credenciais->>'client_secret','account_id',_credenciais->>'account_id')::text,'membros-kiwify-'||gen_random_uuid()::text,'Conexão de leitura Kiwify, membros') INTO s;
 ELSE PERFORM vault.update_secret(s,jsonb_build_object('client_id',_credenciais->>'client_id','client_secret',_credenciais->>'client_secret','account_id',_credenciais->>'account_id')::text,NULL,NULL,NULL); END IF;
 INSERT INTO public.membros_kiwify_config(singleton,integracao_id,segredo_id,nome,verificado_em,atualizado_por) VALUES(true,_integracao,s,left(coalesce(_nome,'Conta Kiwify'),180),now(),_ator) ON CONFLICT(singleton) DO UPDATE SET integracao_id=excluded.integracao_id,segredo_id=excluded.segredo_id,nome=excluded.nome,verificado_em=excluded.verificado_em,atualizado_por=excluded.atualizado_por;
END $$;
CREATE FUNCTION public.membros_kiwify_credenciais() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MEMBROS_SO_SERVIDOR'; END IF;
 RETURN (SELECT s.decrypted_secret::jsonb FROM public.membros_kiwify_config c JOIN public.vendas_integracoes i ON i.id=c.integracao_id AND i.gateway='kiwify' AND i.client_id IS NULL AND i.ativo JOIN vault.decrypted_secrets s ON s.id=c.segredo_id WHERE c.singleton);
END $$;
REVOKE ALL ON FUNCTION public.membros_kiwify_guardar(uuid,jsonb,text,uuid),public.membros_kiwify_credenciais() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.membros_kiwify_guardar(uuid,jsonb,text,uuid),public.membros_kiwify_credenciais() TO service_role;

COMMIT;
