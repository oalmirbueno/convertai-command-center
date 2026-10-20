-- Desenvolvimento apenas. Não aplicar em produção sem revisão, preflight e aprovação.
-- Não contém produtos, benefícios ou concessões fictícias. Direitos não são papéis.
BEGIN;

CREATE TABLE public.membros_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 180),
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 12000),
  categoria text NOT NULL DEFAULT '' CHECK (length(categoria) <= 80),
  formato text NOT NULL DEFAULT 'Material digital' CHECK (length(formato) BETWEEN 1 AND 80),
  capa_url text CHECK (capa_url IS NULL OR capa_url ~ '^https://[^/@[:space:]]+([/][^[:space:]]*)?$'),
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho','publicado','arquivado')),
  gratuito boolean NOT NULL DEFAULT false,
  destaque boolean NOT NULL DEFAULT false,
  checkout_url text CHECK (checkout_url IS NULL OR checkout_url ~ '^https://[^/@[:space:]]+([/][^[:space:]]*)?$'),
  condicoes text NOT NULL DEFAULT '' CHECK (length(condicoes) <= 4000),
  ordem integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id)
);
CREATE TABLE public.membros_materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 180),
  tipo text NOT NULL CHECK (tipo IN ('texto','video','audio','pdf','arquivo')),
  texto text NOT NULL DEFAULT '' CHECK (length(texto) <= 200000),
  arquivo text UNIQUE CHECK (arquivo IS NULL OR arquivo ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[A-Za-z0-9_.-]+$'),
  permite_download boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id),
  CHECK ((tipo = 'texto' AND arquivo IS NULL) OR (tipo <> 'texto' AND arquivo IS NOT NULL)),
  CHECK (arquivo IS NULL OR split_part(arquivo,'/',1) = produto_id::text)
);
CREATE INDEX ON public.membros_materiais(produto_id,ordem);
CREATE TABLE public.membros_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
  origem text NOT NULL CHECK (origem IN ('compra','manual')),
  referencia text NOT NULL CHECK (length(referencia) BETWEEN 1 AND 240),
  inicio timestamptz NOT NULL DEFAULT now(), fim timestamptz,
  revogado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id),
  CHECK (fim IS NULL OR fim > inicio),
  UNIQUE (origem,referencia,produto_id,user_id)
);
CREATE INDEX ON public.membros_acessos(user_id,produto_id);
CREATE TABLE public.membros_beneficios_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plano_id uuid NOT NULL REFERENCES public.financial_plans(id) ON DELETE RESTRICT,
  produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
  ativo boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id),
  UNIQUE(plano_id,produto_id)
);
CREATE TABLE public.membros_progresso (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.membros_materiais(id) ON DELETE RESTRICT,
  posicao numeric NOT NULL DEFAULT 0 CHECK (posicao BETWEEN 0 AND 604800),
  duracao numeric NOT NULL DEFAULT 0 CHECK (duracao BETWEEN 0 AND 604800),
  concluido boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,material_id), CHECK (posicao <= duracao OR duracao = 0)
);
CREATE TABLE public.membros_checklist (
  chave text PRIMARY KEY CHECK (chave ~ '^[a-z_]{1,80}$'),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','em_andamento','bloqueado','concluido')),
  observacao text NOT NULL DEFAULT '' CHECK (length(observacao) <= 2000),
  evidencia text NOT NULL DEFAULT '' CHECK (length(evidencia) <= 2000),
  verificacao text NOT NULL DEFAULT 'manual' CHECK (verificacao = 'manual'),
  atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id)
);
CREATE TABLE public.membros_checklist_historico (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave text NOT NULL, estado text NOT NULL, observacao text NOT NULL, evidencia text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id)
);
CREATE TABLE public.membros_vinculos_venda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.vendas_integracoes(id) ON DELETE RESTRICT,
  produto_externo_id text NOT NULL CHECK (length(produto_externo_id) BETWEEN 1 AND 120),
  produto_id uuid NOT NULL REFERENCES public.membros_produtos(id) ON DELETE RESTRICT,
  regra text NOT NULL CHECK (regra IN ('dias','sem_prazo')),
  dias integer CHECK (dias BETWEEN 1 AND 36500),
  revogar_reembolso boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(), atualizado_por uuid REFERENCES auth.users(id),
  CHECK ((regra = 'dias' AND dias IS NOT NULL) OR (regra = 'sem_prazo' AND dias IS NULL)),
  UNIQUE(integracao_id,produto_externo_id)
);
-- Venda verificada é privada: não contém corpo bruto, cartão ou credenciais.
CREATE TABLE public.membros_compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.vendas_integracoes(id),
  pedido_externo_id text NOT NULL,
  produto_id uuid NOT NULL REFERENCES public.membros_produtos(id),
  comprador_email text NOT NULL,
  user_id uuid REFERENCES auth.users(id),
  estado text NOT NULL CHECK (estado IN ('pendente','pago','reembolsado','contestado')),
  confirmado_em timestamptz NOT NULL DEFAULT now(), inicio timestamptz NOT NULL,
  fim timestamptz, UNIQUE(integracao_id,pedido_externo_id)
);
CREATE TABLE public.membros_processamentos (
  evento_id uuid PRIMARY KEY REFERENCES public.vendas_eventos(id),
  estado text NOT NULL CHECK (estado IN ('aguardando_verificacao','kiwify_pendente','sem_configuracao','confirmado','ignorado','erro')),
  mensagem text NOT NULL DEFAULT '', tentativas integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.membros_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.has_role(auth.uid(),'admin'::public.app_role)
$$;
CREATE FUNCTION public.membros_usuario_confirmado() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL AND NOT COALESCE(is_anonymous,false))
$$;
CREATE FUNCTION public.membros_origens(_produto uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN public.membros_admin() THEN ARRAY['administracao']::text[]
  WHEN NOT public.membros_usuario_confirmado() THEN ARRAY[]::text[] ELSE ARRAY(
    SELECT origem FROM (
      SELECT 'gratuito'::text origem FROM public.membros_produtos WHERE id=_produto AND gratuito AND estado='publicado'
      UNION
      SELECT a.origem FROM public.membros_acessos a JOIN public.membros_produtos p ON p.id=a.produto_id
      WHERE a.produto_id=_produto AND a.user_id=auth.uid() AND a.inicio <= now() AND (a.fim IS NULL OR a.fim > now()) AND a.revogado_em IS NULL AND p.estado='publicado'
      UNION
      SELECT 'plano'::text FROM public.membros_beneficios_plano b
      JOIN public.financial_plan_versions v ON v.plan_id=b.plano_id
      JOIN public.financial_client_terms t ON t.plan_version_id=v.id
      JOIN public.membros_produtos p ON p.id=b.produto_id
      WHERE b.produto_id=_produto AND b.ativo AND p.estado='publicado'
        AND t.client_id=auth.uid() AND public.has_role(auth.uid(),'client'::public.app_role)
        AND t.status='active' AND t.starts_on <= current_date AND (t.ends_on IS NULL OR t.ends_on >= current_date)
    ) direitos
  ) END
$$;
CREATE FUNCTION public.membros_pode_acessar(_produto uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT cardinality(public.membros_origens(_produto)) > 0
$$;

-- Sem papel explícito = membro, nunca cliente operacional. Nenhum papel existente é apagado.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles(id,email,full_name,company_name)
  VALUES(NEW.id,COALESCE(NEW.email,''),COALESCE(NEW.raw_user_meta_data->>'full_name',split_part(COALESCE(NEW.email,''),'@',1)),NEW.raw_user_meta_data->>'company_name')
  ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,full_name=EXCLUDED.full_name;
  RETURN NEW;
END $$;

-- Defesa adicional para o novo tipo de identidade, sem ampliar políticas antigas.
-- Somente tabelas já sujeitas a RLS. Não cria política permissiva ou altera grants operacionais.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND c.relname NOT LIKE 'membros_%' AND c.relname NOT IN ('profiles','user_roles')
  LOOP
    EXECUTE format('CREATE POLICY membros_sem_papel_sem_operacao ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.has_role(auth.uid(),''admin''::public.app_role) OR public.has_role(auth.uid(),''client''::public.app_role) OR public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),''admin''::public.app_role) OR public.has_role(auth.uid(),''client''::public.app_role) OR public.is_staff(auth.uid()))',t.relname);
  END LOOP;
END $$;

CREATE FUNCTION public.membros_auditar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.atualizado_em := now(); NEW.atualizado_por := auth.uid();
  IF TG_TABLE_NAME='membros_checklist' THEN
    IF (NEW.observacao || ' ' || NEW.evidencia) ~* '(password|senha|api[_ -]?key|bearer |-----BEGIN|access_token|secret[_ =:]|token[_ =:])' THEN
      RAISE EXCEPTION 'Não salve credenciais no checklist' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.membros_checklist_historico(chave,estado,observacao,evidencia,atualizado_por)
    VALUES(NEW.chave,NEW.estado,NEW.observacao,NEW.evidencia,auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION public.membros_progresso_guardar() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['produtos','materiais','acessos','beneficios_plano','checklist','vinculos_venda'] LOOP
    EXECUTE format('CREATE TRIGGER membros_auditoria BEFORE INSERT OR UPDATE ON public.membros_%I FOR EACH ROW EXECUTE FUNCTION public.membros_auditar()',n);
  END LOOP;
END $$;
CREATE TRIGGER membros_progresso_data BEFORE INSERT OR UPDATE ON public.membros_progresso FOR EACH ROW EXECUTE FUNCTION public.membros_progresso_guardar();

DO $$ DECLARE n text; BEGIN
  FOREACH n IN ARRAY ARRAY['produtos','materiais','acessos','beneficios_plano','progresso','checklist','checklist_historico','vinculos_venda','compras','processamentos'] LOOP
    EXECUTE format('ALTER TABLE public.membros_%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('REVOKE ALL ON public.membros_%I FROM PUBLIC,anon,authenticated',n);
    EXECUTE format('GRANT SELECT ON public.membros_%I TO authenticated',n);
    EXECUTE format('GRANT ALL ON public.membros_%I TO service_role',n);
  END LOOP;
END $$;
GRANT INSERT,UPDATE,DELETE ON public.membros_produtos,public.membros_materiais,public.membros_beneficios_plano,public.membros_vinculos_venda TO authenticated;
GRANT INSERT,UPDATE ON public.membros_acessos,public.membros_checklist,public.membros_progresso TO authenticated;
CREATE POLICY catalogo_le ON public.membros_produtos FOR SELECT TO authenticated USING (estado='publicado' OR public.membros_admin());
CREATE POLICY catalogo_admin ON public.membros_produtos FOR ALL TO authenticated USING (public.membros_admin()) WITH CHECK (public.membros_admin());
CREATE POLICY material_le ON public.membros_materiais FOR SELECT TO authenticated USING (public.membros_pode_acessar(produto_id));
CREATE POLICY material_admin ON public.membros_materiais FOR ALL TO authenticated USING (public.membros_admin()) WITH CHECK (public.membros_admin());
CREATE POLICY acesso_le ON public.membros_acessos FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.membros_admin());
CREATE POLICY acesso_admin ON public.membros_acessos FOR ALL TO authenticated USING (public.membros_admin() AND origem='manual') WITH CHECK (public.membros_admin() AND origem='manual');
CREATE POLICY beneficio_admin ON public.membros_beneficios_plano FOR ALL TO authenticated USING (public.membros_admin()) WITH CHECK (public.membros_admin());
CREATE POLICY progresso_proprio ON public.membros_progresso FOR ALL TO authenticated
 USING (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.id=material_id AND public.membros_pode_acessar(m.produto_id)))
 WITH CHECK (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.id=material_id AND public.membros_pode_acessar(m.produto_id)));
CREATE POLICY checklist_admin ON public.membros_checklist FOR ALL TO authenticated USING (public.membros_admin()) WITH CHECK (public.membros_admin());
CREATE POLICY checklist_historico_admin ON public.membros_checklist_historico FOR SELECT TO authenticated USING (public.membros_admin());
CREATE POLICY vinculos_admin ON public.membros_vinculos_venda FOR ALL TO authenticated USING (public.membros_admin()) WITH CHECK (public.membros_admin() AND EXISTS(SELECT 1 FROM public.vendas_integracoes i WHERE i.id=integracao_id AND i.client_id IS NULL AND i.gateway IN ('kiwify','asaas')));
CREATE POLICY compras_le ON public.membros_compras FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.membros_admin());
CREATE POLICY processamentos_admin ON public.membros_processamentos FOR SELECT TO authenticated USING (public.membros_admin());

-- Bucket novo e privado, nunca converte buckets antigos nem publica arquivos existentes.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('membros-materiais','membros-materiais',false,524288000,ARRAY['video/mp4','video/webm','audio/mpeg','audio/mp4','audio/ogg','application/pdf','application/zip','image/png','image/jpeg','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='membros-materiais' AND public) THEN RAISE EXCEPTION 'Bucket de membros existente é público; revisar antes de continuar'; END IF;
END $$;
CREATE POLICY membros_storage_le ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='membros-materiais' AND EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.arquivo=name AND public.membros_pode_acessar(m.produto_id)));
CREATE POLICY membros_storage_admin ON storage.objects FOR ALL TO authenticated
 USING(bucket_id='membros-materiais' AND public.membros_admin()) WITH CHECK(bucket_id='membros-materiais' AND public.membros_admin());
-- Políticas antigas de storage são permissivas: a restritiva impede que abram este bucket.
CREATE POLICY membros_storage_barreira ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING ((bucket_id='membros-materiais' AND (public.membros_admin() OR EXISTS(SELECT 1 FROM public.membros_materiais m WHERE m.arquivo=name AND public.membros_pode_acessar(m.produto_id)))) OR (bucket_id<>'membros-materiais' AND (public.has_role(auth.uid(),'client'::public.app_role) OR public.is_staff(auth.uid()))))
 WITH CHECK ((bucket_id='membros-materiais' AND public.membros_admin()) OR (bucket_id<>'membros-materiais' AND (public.has_role(auth.uid(),'client'::public.app_role) OR public.is_staff(auth.uid()))));
CREATE POLICY membros_storage_anon_barreira ON storage.objects AS RESTRICTIVE FOR ALL TO anon
 USING (bucket_id<>'membros-materiais') WITH CHECK (bucket_id<>'membros-materiais');

-- Reivindicação só pela identidade confirmada; não aceita e-mail/usuário do navegador.
CREATE FUNCTION public.membros_reivindicar_compras() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE email_atual text;
BEGIN
  IF NOT public.membros_usuario_confirmado() THEN RETURN; END IF;
  SELECT lower(email) INTO email_atual FROM auth.users WHERE id=auth.uid();
  IF 1<>(SELECT count(*) FROM auth.users WHERE lower(email)=email_atual AND email_confirmed_at IS NOT NULL) THEN RETURN; END IF;
  UPDATE public.membros_compras SET user_id=auth.uid() WHERE user_id IS NULL AND lower(comprador_email)=email_atual;
  INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia,inicio,fim,revogado_em)
    SELECT c.user_id,c.produto_id,'compra',c.id::text,c.inicio,c.fim,
      CASE WHEN c.estado IN ('reembolsado','contestado') THEN now() END
    FROM public.membros_compras c WHERE c.user_id=auth.uid() AND c.estado<>'pendente'
  ON CONFLICT(origem,referencia,produto_id,user_id) DO UPDATE SET revogado_em=COALESCE(membros_acessos.revogado_em,EXCLUDED.revogado_em);
END $$;
CREATE FUNCTION public.membros_catalogo() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE resultado jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada' USING ERRCODE='42501'; END IF;
  PERFORM public.membros_reivindicar_compras();
  SELECT jsonb_build_object('produtos',COALESCE((
    SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object('origens',public.membros_origens(p.id),
      'progresso',COALESCE((SELECT round(100.0*sum(CASE WHEN pr.concluido THEN 1 WHEN pr.duracao>0 THEN LEAST(pr.posicao/pr.duracao,0.99) ELSE 0 END)/NULLIF(count(*),0)) FROM public.membros_materiais m LEFT JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=auth.uid() WHERE m.produto_id=p.id),0),
      'ultimo_material',(SELECT m.id FROM public.membros_materiais m JOIN public.membros_progresso pr ON pr.material_id=m.id AND pr.user_id=auth.uid() WHERE m.produto_id=p.id AND (pr.posicao>0 OR pr.concluido) ORDER BY pr.atualizado_em DESC LIMIT 1)
    ) ORDER BY p.ordem,p.titulo) FROM public.membros_produtos p WHERE p.estado='publicado' OR public.membros_admin()
  ),'[]'::jsonb),'pendentes',COALESCE((SELECT jsonb_agg(jsonb_build_object('produto_id',produto_id,'estado',estado)) FROM public.membros_compras WHERE user_id=auth.uid() AND estado='pendente'),'[]'::jsonb)) INTO resultado;
  RETURN resultado;
END $$;

-- Confirmação chamada SOMENTE pelo servidor após consultar o gateway. Sem corpo bruto.
CREATE FUNCTION public.membros_conciliar_pagamento(_evento uuid,_pedido text,_produto_externo text,_email text,_estado text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev public.vendas_eventos; vinc public.membros_vinculos_venda; compra public.membros_compras; inicio_compra timestamptz; estado_final text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'Somente servidor' USING ERRCODE='42501'; END IF;
  IF _estado NOT IN ('pendente','pago','reembolsado','contestado') OR _email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' OR length(_pedido)>200 THEN RAISE EXCEPTION 'Confirmação inválida'; END IF;
  SELECT * INTO STRICT ev FROM public.vendas_eventos WHERE id=_evento;
  IF _pedido IS DISTINCT FROM split_part(ev.id_externo,':',1) THEN RAISE EXCEPTION 'Pedido não corresponde ao evento'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vendas_integracoes i WHERE i.id=ev.integracao_id AND i.client_id IS NULL AND i.ativo AND i.gateway='asaas') THEN RAISE EXCEPTION 'Integração não autorizada'; END IF;
  SELECT * INTO STRICT vinc FROM public.membros_vinculos_venda WHERE integracao_id=ev.integracao_id AND produto_externo_id=_produto_externo AND ativo;
  IF _estado IN ('reembolsado','contestado') AND NOT vinc.revogar_reembolso THEN
    RAISE EXCEPTION 'Regra de reembolso ou contestação exige decisão administrativa';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(ev.integracao_id::text || ':' || _pedido,0));
  SELECT * INTO compra FROM public.membros_compras WHERE integracao_id=ev.integracao_id AND pedido_externo_id=_pedido FOR UPDATE;
  IF compra.id IS NOT NULL AND (compra.produto_id<>vinc.produto_id OR lower(compra.comprador_email)<>lower(_email)) THEN RAISE EXCEPTION 'Identidade ou produto diverge da confirmação anterior'; END IF;
  estado_final := CASE WHEN compra.estado IN ('reembolsado','contestado') THEN compra.estado ELSE _estado END;
  inicio_compra := CASE WHEN compra.estado='pendente' AND _estado='pago' THEN now() ELSE COALESCE(compra.inicio,now()) END;
  INSERT INTO public.membros_compras(integracao_id,pedido_externo_id,produto_id,comprador_email,estado,inicio,fim)
  VALUES(ev.integracao_id,_pedido,vinc.produto_id,lower(_email),estado_final,inicio_compra,CASE WHEN vinc.regra='dias' THEN inicio_compra+make_interval(days=>vinc.dias) END)
  ON CONFLICT(integracao_id,pedido_externo_id) DO UPDATE SET estado=estado_final,confirmado_em=now(),
    inicio=CASE WHEN membros_compras.estado='pendente' AND estado_final='pago' THEN EXCLUDED.inicio ELSE membros_compras.inicio END,
    fim=CASE WHEN membros_compras.estado='pendente' AND estado_final='pago' THEN EXCLUDED.fim ELSE membros_compras.fim END RETURNING * INTO compra;
  -- Identidades sem e-mail confirmado não são vinculadas, tampouco criadas.
  UPDATE public.membros_compras c SET user_id=u.id FROM auth.users u
    WHERE c.id=compra.id AND c.user_id IS NULL AND lower(u.email)=lower(_email) AND u.email_confirmed_at IS NOT NULL AND NOT COALESCE(u.is_anonymous,false)
      AND 1=(SELECT count(*) FROM auth.users x WHERE lower(x.email)=lower(_email) AND x.email_confirmed_at IS NOT NULL);
  SELECT * INTO compra FROM public.membros_compras WHERE id=compra.id;
  IF compra.user_id IS NOT NULL AND estado_final<>'pendente' THEN
    INSERT INTO public.membros_acessos(user_id,produto_id,origem,referencia,inicio,fim,revogado_em)
    VALUES(compra.user_id,compra.produto_id,'compra',compra.id::text,compra.inicio,compra.fim,CASE WHEN estado_final IN ('reembolsado','contestado') THEN now() END)
    ON CONFLICT(origem,referencia,produto_id,user_id) DO UPDATE SET revogado_em=COALESCE(membros_acessos.revogado_em,EXCLUDED.revogado_em);
  END IF;
  INSERT INTO public.membros_processamentos(evento_id,estado,tentativas,mensagem) VALUES(_evento,'confirmado',1,'Estado conferido no servidor')
    ON CONFLICT(evento_id) DO UPDATE SET estado='confirmado',tentativas=membros_processamentos.tentativas+1,atualizado_em=now(),mensagem=EXCLUDED.mensagem;
  RETURN jsonb_build_object('ok',true,'estado',estado_final);
END $$;

-- Eventos existentes do CRM continuam intactos. Aviso apenas prepara a fila, nunca concede direito.
CREATE FUNCTION public.membros_preparar_evento() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.membros_vinculos_venda v JOIN public.vendas_integracoes i ON i.id=v.integracao_id WHERE v.integracao_id=NEW.integracao_id AND v.produto_externo_id=NEW.produto_externo_id AND v.ativo AND i.client_id IS NULL) THEN
    INSERT INTO public.membros_processamentos(evento_id,estado) VALUES(NEW.id,'aguardando_verificacao') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membros_evento_recebido AFTER INSERT ON public.vendas_eventos FOR EACH ROW EXECUTE FUNCTION public.membros_preparar_evento();

-- Funções privileged: nenhuma herda EXECUTE de PUBLIC. Somente as consultas necessárias são expostas.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure nome FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'membros_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.nome);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.membros_admin(),public.membros_usuario_confirmado(),public.membros_origens(uuid),public.membros_pode_acessar(uuid),public.membros_reivindicar_compras(),public.membros_catalogo() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.membros_conciliar_pagamento(uuid,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;

COMMIT;
