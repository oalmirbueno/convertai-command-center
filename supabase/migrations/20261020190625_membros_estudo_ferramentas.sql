-- Desenvolvimento para revisão. Não aplicado ao backend remoto.
-- A biblioteca anterior e o gate de pagamentos não são alterados.
BEGIN;
CREATE SCHEMA IF NOT EXISTS membros_privado;
REVOKE ALL ON SCHEMA membros_privado FROM PUBLIC,anon,authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('membros-capas','membros-capas',true,5242880,ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='membros-capas' AND (NOT public OR file_size_limit IS NULL OR file_size_limit>5242880 OR allowed_mime_types IS NULL OR EXISTS(SELECT 1 FROM unnest(allowed_mime_types) m WHERE m NOT IN('image/jpeg','image/png','image/webp')))) THEN
  RAISE EXCEPTION 'Bucket de capas existente tem configuração diferente. Revisar sem expor arquivos privados.';
 END IF;
END $$;
CREATE POLICY membros_capas_admin ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='membros-capas' AND public.membros_admin()
 AND name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.webp$');
-- Políticas permissivas antigas não podem autorizar upload de capa por um membro.
CREATE POLICY membros_capas_barreira ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id<>'membros-capas' OR public.membros_admin())
WITH CHECK(bucket_id<>'membros-capas' OR public.membros_admin());

CREATE TABLE public.membros_canais (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), produto_id uuid NOT NULL REFERENCES public.membros_produtos(id),
 nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 80),
 tipo text NOT NULL CHECK(tipo IN('whatsapp','telegram','outro')),
 url text NOT NULL CHECK(length(url)<=2000 AND url ~ '^https://[^/@[:space:]]+(/|$)'),
 ativo boolean NOT NULL DEFAULT true, ordem integer NOT NULL DEFAULT 0 CHECK(ordem BETWEEN 0 AND 10000)
);
ALTER TABLE public.membros_canais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_canais FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.membros_comunidade_canais(_produto uuid,_teste boolean DEFAULT false,_bloqueado boolean DEFAULT false,_previa uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.membros_acervo(_produto,_teste,_bloqueado,_previa);
 IF NOT EXISTS(SELECT 1 FROM public.membros_produtos WHERE id=_produto AND comunidade_ativa) THEN RETURN '[]'::jsonb; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY ordem,nome) FROM public.membros_canais c WHERE c.produto_id=_produto AND (c.ativo OR (public.membros_admin() AND NOT _teste AND _previa IS NULL))),'[]'::jsonb);
END $$;
CREATE FUNCTION public.membros_comunidade_canal_salvar(_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE canal uuid:=(_dados->>'id')::uuid; produto uuid:=(_dados->>'produto_id')::uuid;
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.membros_canais WHERE id=canal AND produto_id<>produto) THEN RAISE EXCEPTION 'Grupo de outro produto' USING ERRCODE='22023'; END IF;
 INSERT INTO public.membros_canais(id,produto_id,nome,tipo,url,ativo,ordem)
 VALUES(canal,produto,btrim(_dados->>'nome'),_dados->>'tipo',btrim(_dados->>'url'),(_dados->>'ativo')::boolean,COALESCE((_dados->>'ordem')::int,0))
 ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome,tipo=EXCLUDED.tipo,url=EXCLUDED.url,ativo=EXCLUDED.ativo,ordem=EXCLUDED.ordem;
 RETURN canal;
END $$;

-- Os produtos continuam no catálogo existente. O motor é um vínculo explícito.
CREATE TABLE public.membros_ferramentas (
 produto_id uuid PRIMARY KEY REFERENCES public.membros_produtos(id),
 motor text NOT NULL CHECK(motor IN('crm','proxima_resposta')), ativo boolean NOT NULL DEFAULT false,
 upgrade_mensal jsonb NOT NULL DEFAULT '{"estado":"rascunho","recursos":[],"cobranca_ativa":false}'::jsonb CHECK(jsonb_typeof(upgrade_mensal)='object')
);
CREATE FUNCTION membros_privado.fim_anual(_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$ SELECT ((_inicio AT TIME ZONE 'UTC') + interval '12 months') AT TIME ZONE 'UTC' $$;
CREATE TABLE public.membros_licencas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), produto_id uuid NOT NULL REFERENCES public.membros_ferramentas(produto_id),
 user_id uuid NOT NULL REFERENCES auth.users(id), origem text NOT NULL CHECK(origem IN('pagamento','validacao_manual')),
 referencia text NOT NULL, confirmado_em timestamptz NOT NULL,
 fim timestamptz GENERATED ALWAYS AS (membros_privado.fim_anual(confirmado_em)) STORED,
 revogado_em timestamptz, criado_por uuid REFERENCES auth.users(id), criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(produto_id,user_id,origem,referencia)
);
CREATE INDEX membros_licencas_titular ON public.membros_licencas(user_id,produto_id,fim);
CREATE TABLE public.membros_sessoes_ferramenta (
 user_id uuid NOT NULL REFERENCES auth.users(id), produto_id uuid NOT NULL REFERENCES public.membros_ferramentas(produto_id),
 prova_hash bytea NOT NULL, fim timestamptz NOT NULL, atualizado_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,produto_id)
);
CREATE TABLE public.membros_crm_contatos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 produto_id uuid NOT NULL REFERENCES public.membros_ferramentas(produto_id),
 nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 120), empresa text NOT NULL DEFAULT '' CHECK(length(empresa)<=180),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=254), telefone text NOT NULL DEFAULT '' CHECK(length(telefone)<=40),
 notas text NOT NULL DEFAULT '' CHECK(length(notas)<=4000), arquivado boolean NOT NULL DEFAULT false,
 versao integer NOT NULL DEFAULT 1, atualizado_em timestamptz NOT NULL DEFAULT now(), criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,user_id,produto_id)
);
CREATE TABLE public.membros_crm_negocios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 produto_id uuid NOT NULL REFERENCES public.membros_ferramentas(produto_id), contato_id uuid,
 titulo text NOT NULL CHECK(length(btrim(titulo)) BETWEEN 1 AND 180),
 estagio text NOT NULL DEFAULT 'novo' CHECK(estagio IN('novo','contato','diagnostico','proposta','negociacao','ganho','perdido')),
 valor numeric(14,2) NOT NULL DEFAULT 0 CHECK(valor>=0),
 proxima_acao text NOT NULL DEFAULT '' CHECK(length(proxima_acao)<=1000), proxima_data date,
 notas text NOT NULL DEFAULT '' CHECK(length(notas)<=4000), arquivado boolean NOT NULL DEFAULT false,
 versao integer NOT NULL DEFAULT 1, atualizado_em timestamptz NOT NULL DEFAULT now(), criado_em timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contato_id,user_id,produto_id) REFERENCES public.membros_crm_contatos(id,user_id,produto_id)
);
CREATE INDEX membros_crm_contatos_titular ON public.membros_crm_contatos(user_id,produto_id,atualizado_em DESC);
CREATE INDEX membros_crm_negocios_titular ON public.membros_crm_negocios(user_id,produto_id,estagio);
CREATE TABLE public.membros_ferramentas_historico (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, produto_id uuid NOT NULL,
 ator uuid NOT NULL, acao text NOT NULL, registro_id uuid, criado_em timestamptz NOT NULL DEFAULT now()
);
-- Nada é apagado por vencimento. Pedidos de exclusão ficam explícitos para a administração.
CREATE TABLE public.membros_pedidos_exclusao (
 user_id uuid NOT NULL REFERENCES auth.users(id), produto_id uuid NOT NULL REFERENCES public.membros_ferramentas(produto_id),
 solicitado_em timestamptz NOT NULL DEFAULT now(), atendido_em timestamptz,
 PRIMARY KEY(user_id,produto_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['membros_ferramentas','membros_licencas','membros_sessoes_ferramenta','membros_crm_contatos','membros_crm_negocios','membros_ferramentas_historico','membros_pedidos_exclusao'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;

CREATE FUNCTION membros_privado.autorizar_ferramenta(_produto uuid,_motor text DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE vencimento timestamptz;
BEGIN
 IF NOT public.membros_usuario_confirmado() THEN RAISE EXCEPTION 'Entre e confirme seu cadastro' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.membros_ferramentas f JOIN public.membros_produtos p ON p.id=f.produto_id
  WHERE f.produto_id=_produto AND f.ativo AND p.estado='publicado' AND (_motor IS NULL OR f.motor=_motor)) THEN
  RAISE EXCEPTION 'Ferramenta indisponível' USING ERRCODE='42501'; END IF;
 SELECT max(fim) INTO vencimento FROM public.membros_licencas WHERE produto_id=_produto AND user_id=auth.uid()
  AND revogado_em IS NULL AND confirmado_em<=now() AND fim>now();
 IF vencimento IS NULL THEN RAISE EXCEPTION 'O acesso a esta ferramenta não está liberado ou venceu. Seus dados permanecem privados.' USING ERRCODE='42501'; END IF;
 RETURN vencimento;
END $$;
CREATE FUNCTION membros_privado.validar_sessao(_produto uuid,_prova text,_motor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM membros_privado.autorizar_ferramenta(_produto,_motor);
 IF _prova IS NULL OR _prova !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Abra a ferramenta novamente' USING ERRCODE='42501'; END IF;
 -- O bloqueio acompanha a operação inteira. Uma troca de dispositivo não cruza uma escrita em andamento.
 PERFORM 1 FROM public.membros_sessoes_ferramenta WHERE user_id=auth.uid() AND produto_id=_produto
  AND prova_hash=sha256(convert_to(_prova,'UTF8')) AND fim>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'A ferramenta está aberta em outro dispositivo ou a sessão venceu. Abra novamente para continuar.' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.membros_ferramenta_sessao(_produto uuid,_prova text,_substituir boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE atual public.membros_sessoes_ferramenta; vencimento timestamptz;
BEGIN
 vencimento:=membros_privado.autorizar_ferramenta(_produto);
 IF _prova IS NULL OR _prova !~ '^[a-f0-9]{64}$' OR _substituir IS NULL THEN RAISE EXCEPTION 'Sessão inválida' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||_produto::text,1));
 SELECT * INTO atual FROM public.membros_sessoes_ferramenta WHERE user_id=auth.uid() AND produto_id=_produto FOR UPDATE;
 IF atual.fim>now() AND atual.prova_hash<>sha256(convert_to(_prova,'UTF8')) AND NOT _substituir THEN
  RETURN jsonb_build_object('conflito',true,'mensagem','Esta ferramenta está aberta em outro dispositivo. Continuar aqui encerra apenas a sessão da ferramenta naquele dispositivo.'); END IF;
 INSERT INTO public.membros_sessoes_ferramenta(user_id,produto_id,prova_hash,fim) VALUES(auth.uid(),_produto,sha256(convert_to(_prova,'UTF8')),least(vencimento,now()+interval '15 minutes'))
 ON CONFLICT(user_id,produto_id) DO UPDATE SET prova_hash=EXCLUDED.prova_hash,fim=EXCLUDED.fim,atualizado_em=now();
 IF atual.prova_hash IS DISTINCT FROM sha256(convert_to(_prova,'UTF8')) THEN
  INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao) VALUES(auth.uid(),_produto,auth.uid(),CASE WHEN atual.user_id IS NULL THEN 'sessao_aberta' ELSE 'dispositivo_substituido' END); END IF;
 RETURN jsonb_build_object('conflito',false,'licenca_fim',vencimento,'sessao_fim',least(vencimento,now()+interval '15 minutes'));
END $$;
CREATE FUNCTION public.membros_ferramentas_catalogo() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_usuario_confirmado() THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('produto_id',f.produto_id,'motor',f.motor,'titulo',p.titulo,'capa_url',p.capa_url,
 'disponivel',f.ativo AND p.estado='publicado',
 'fim',CASE WHEN f.ativo AND p.estado='publicado' THEN (SELECT max(l.fim) FROM public.membros_licencas l WHERE l.produto_id=f.produto_id AND l.user_id=auth.uid() AND l.revogado_em IS NULL AND l.confirmado_em<=now() AND l.fim>now()) END) ORDER BY p.ordem)
 FROM public.membros_ferramentas f JOIN public.membros_produtos p ON p.id=f.produto_id WHERE (f.ativo AND p.estado='publicado') OR EXISTS(SELECT 1 FROM public.membros_licencas l WHERE l.produto_id=f.produto_id AND l.user_id=auth.uid())),'[]'::jsonb);
END $$;
CREATE FUNCTION public.membros_ferramenta_configurar(_produto uuid,_motor text,_ativo boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.membros_ferramentas WHERE produto_id=_produto AND motor<>_motor)
  AND EXISTS(SELECT 1 FROM public.membros_licencas WHERE produto_id=_produto) THEN RAISE EXCEPTION 'Não troque o tipo de uma ferramenta que já tem licenças' USING ERRCODE='22023'; END IF;
 INSERT INTO public.membros_ferramentas(produto_id,motor,ativo) VALUES(_produto,_motor,_ativo)
 ON CONFLICT(produto_id) DO UPDATE SET motor=EXCLUDED.motor,ativo=EXCLUDED.ativo;
END $$;
CREATE FUNCTION public.membros_ferramenta_licenca_teste(_produto uuid,_usuario uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE novo uuid;
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 INSERT INTO public.membros_licencas(produto_id,user_id,origem,referencia,confirmado_em,criado_por)
 VALUES(_produto,_usuario,'validacao_manual','validacao-inicial',now(),auth.uid()) ON CONFLICT(produto_id,user_id,origem,referencia) DO NOTHING RETURNING id INTO novo;
 RETURN COALESCE(novo,(SELECT id FROM public.membros_licencas WHERE produto_id=_produto AND user_id=_usuario AND origem='validacao_manual' AND referencia='validacao-inicial'));
END $$;
CREATE FUNCTION public.membros_ferramenta_revogar(_licenca uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 UPDATE public.membros_licencas SET revogado_em=now() WHERE id=_licenca AND revogado_em IS NULL;
END $$;

CREATE FUNCTION public.membros_crm_operar(_produto uuid,_prova text,_acao text DEFAULT 'listar',_dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE novo uuid; versao_atual integer; contato uuid;
BEGIN
 PERFORM membros_privado.validar_sessao(_produto,_prova,'crm');
 IF _acao='listar' THEN
  RETURN jsonb_build_object('contatos',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.nome) FROM public.membros_crm_contatos c WHERE c.user_id=auth.uid() AND c.produto_id=_produto),'[]'::jsonb),
   'negocios',COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.atualizado_em DESC) FROM public.membros_crm_negocios n WHERE n.user_id=auth.uid() AND n.produto_id=_produto),'[]'::jsonb));
 END IF;
 IF _acao NOT IN('salvar_contato','salvar_negocio') OR _acao IS NULL OR _dados IS NULL OR pg_column_size(_dados)>20000 THEN RAISE EXCEPTION 'Operação inválida' USING ERRCODE='22023'; END IF;
 novo:=COALESCE((_dados->>'id')::uuid,gen_random_uuid());
 IF _acao='salvar_contato' THEN
  SELECT versao INTO versao_atual FROM public.membros_crm_contatos WHERE id=novo AND user_id=auth.uid() AND produto_id=_produto FOR UPDATE;
  IF versao_atual IS NOT NULL AND versao_atual IS DISTINCT FROM (_dados->>'versao')::int THEN RAISE EXCEPTION 'Este contato mudou em outra aba. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
  INSERT INTO public.membros_crm_contatos(id,user_id,produto_id,nome,empresa,email,telefone,notas,arquivado)
  VALUES(novo,auth.uid(),_produto,btrim(_dados->>'nome'),COALESCE(_dados->>'empresa',''),COALESCE(_dados->>'email',''),COALESCE(_dados->>'telefone',''),COALESCE(_dados->>'notas',''),COALESCE((_dados->>'arquivado')::boolean,false))
  ON CONFLICT(id) DO UPDATE SET nome=EXCLUDED.nome,empresa=EXCLUDED.empresa,email=EXCLUDED.email,telefone=EXCLUDED.telefone,notas=EXCLUDED.notas,arquivado=EXCLUDED.arquivado,versao=membros_crm_contatos.versao+1,atualizado_em=now()
  WHERE membros_crm_contatos.user_id=auth.uid() AND membros_crm_contatos.produto_id=_produto;
 ELSE
  contato:=(_dados->>'contato_id')::uuid;
  IF contato IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.membros_crm_contatos c WHERE c.id=contato AND c.user_id=auth.uid() AND c.produto_id=_produto AND (NOT c.arquivado OR EXISTS(SELECT 1 FROM public.membros_crm_negocios n WHERE n.id=novo AND n.user_id=auth.uid() AND n.produto_id=_produto AND n.contato_id=c.id))) THEN RAISE EXCEPTION 'Contato indisponível' USING ERRCODE='42501'; END IF;
  SELECT versao INTO versao_atual FROM public.membros_crm_negocios WHERE id=novo AND user_id=auth.uid() AND produto_id=_produto FOR UPDATE;
  IF versao_atual IS NOT NULL AND versao_atual IS DISTINCT FROM (_dados->>'versao')::int THEN RAISE EXCEPTION 'Este negócio mudou em outra aba. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
  INSERT INTO public.membros_crm_negocios(id,user_id,produto_id,contato_id,titulo,estagio,valor,proxima_acao,proxima_data,notas,arquivado)
  VALUES(novo,auth.uid(),_produto,contato,btrim(_dados->>'titulo'),_dados->>'estagio',COALESCE((_dados->>'valor')::numeric,0),COALESCE(_dados->>'proxima_acao',''),(_dados->>'proxima_data')::date,COALESCE(_dados->>'notas',''),COALESCE((_dados->>'arquivado')::boolean,false))
  ON CONFLICT(id) DO UPDATE SET contato_id=EXCLUDED.contato_id,titulo=EXCLUDED.titulo,estagio=EXCLUDED.estagio,valor=EXCLUDED.valor,proxima_acao=EXCLUDED.proxima_acao,proxima_data=EXCLUDED.proxima_data,notas=EXCLUDED.notas,arquivado=EXCLUDED.arquivado,versao=membros_crm_negocios.versao+1,atualizado_em=now()
  WHERE membros_crm_negocios.user_id=auth.uid() AND membros_crm_negocios.produto_id=_produto;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registro indisponível' USING ERRCODE='42501'; END IF;
 INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao,registro_id) VALUES(auth.uid(),_produto,auth.uid(),_acao,novo);
 RETURN jsonb_build_object('id',novo);
END $$;

CREATE FUNCTION public.membros_ferramenta_pedir_exclusao(_produto uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_usuario_confirmado() OR NOT EXISTS(SELECT 1 FROM public.membros_licencas WHERE user_id=auth.uid() AND produto_id=_produto) THEN RAISE EXCEPTION 'Sem permissão' USING ERRCODE='42501'; END IF;
 INSERT INTO public.membros_pedidos_exclusao(user_id,produto_id) VALUES(auth.uid(),_produto)
 ON CONFLICT(user_id,produto_id) DO UPDATE SET solicitado_em=now(),atendido_em=NULL WHERE membros_pedidos_exclusao.atendido_em IS NOT NULL;
END $$;
CREATE FUNCTION public.membros_ferramentas_admin(_usuario uuid DEFAULT NULL,_produto uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ferramentas',COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.membros_ferramentas f),'[]'::jsonb),
  'licencas',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('titular',p.full_name,'email',p.email) ORDER BY l.criado_em DESC) FROM public.membros_licencas l JOIN public.profiles p ON p.id=l.user_id WHERE (_usuario IS NULL OR l.user_id=_usuario) AND (_produto IS NULL OR l.produto_id=_produto)),'[]'::jsonb),
  'exclusoes',COALESCE((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('contatos_total',(SELECT count(*) FROM public.membros_crm_contatos c WHERE c.user_id=e.user_id AND c.produto_id=e.produto_id),'negocios_total',(SELECT count(*) FROM public.membros_crm_negocios n WHERE n.user_id=e.user_id AND n.produto_id=e.produto_id))) FROM public.membros_pedidos_exclusao e WHERE e.atendido_em IS NULL),'[]'::jsonb),
  'contatos',CASE WHEN _usuario IS NOT NULL AND _produto IS NOT NULL THEN COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.membros_crm_contatos c WHERE c.user_id=_usuario AND c.produto_id=_produto),'[]'::jsonb) ELSE '[]'::jsonb END,
  'negocios',CASE WHEN _usuario IS NOT NULL AND _produto IS NOT NULL THEN COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.membros_crm_negocios n WHERE n.user_id=_usuario AND n.produto_id=_produto),'[]'::jsonb) ELSE '[]'::jsonb END);
END $$;

-- Ajuda após orçamento: regras estruturadas no servidor, sem enviar mensagens nem guardar entradas.
CREATE FUNCTION public.membros_proxima_resposta(_produto uuid,_prova text,_situacao text,_oferta text,_combinado date DEFAULT NULL,_tentativas integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM membros_privado.validar_sessao(_produto,_prova,'proxima_resposta');
 IF _situacao IS NULL OR _situacao NOT IN('sem_resposta','duvida','preco','recusa') OR _tentativas IS NULL OR _tentativas NOT BETWEEN 0 AND 20 OR _oferta IS NULL OR length(btrim(_oferta)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Confira a oferta, a situação e as tentativas' USING ERRCODE='22023'; END IF;
 -- A descrição entra como texto simples. Não é instrução de IA e não fica armazenada.
 IF _situacao='recusa' THEN RETURN jsonb_build_object('acao','encerrar','mensagem','','orientacao','Respeite a recusa. Não envie outra cobrança de resposta.','proximo','Encerre este acompanhamento.'); END IF;
 IF _combinado>(now() AT TIME ZONE 'UTC')::date THEN RETURN jsonb_build_object('acao','aguardar','mensagem','','orientacao','Aguarde a data combinada.','proximo','Retome em '||to_char(_combinado,'DD/MM/YYYY')||'.'); END IF;
 IF _tentativas>=2 THEN RETURN jsonb_build_object('acao','revisar','mensagem','','orientacao','Já houve mais de uma tentativa. Evite insistir sem um motivo novo.','proximo','Revise o contexto e decida se faz sentido encerrar.'); END IF;
 RETURN jsonb_build_object('acao','revisar_e_enviar','mensagem',CASE _situacao
 WHEN 'duvida' THEN 'Olá! Qual ponto do orçamento você gostaria de esclarecer? Posso explicar o que está incluído para ajudar na sua decisão.'
 WHEN 'preco' THEN 'Olá! Entendi sua dúvida sobre o valor. Qual parte da proposta você gostaria de revisar para avaliarmos as opções possíveis?'
 ELSE 'Olá! Conseguiu avaliar o orçamento que enviei sobre '||btrim(_oferta)||'? Se houver alguma dúvida sobre a proposta, posso ajudar.' END,
 'orientacao','Modelo de apoio baseado na situação escolhida. Edite antes de enviar. Nada será enviado automaticamente.',
 'proximo','Se houver resposta, registre o próximo passo combinado. Sem resposta, evite repetir a mesma mensagem.');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA membros_privado FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure assinatura FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('membros_comunidade_canais','membros_comunidade_canal_salvar','membros_ferramenta_sessao','membros_ferramentas_catalogo','membros_ferramenta_configurar','membros_ferramenta_licenca_teste','membros_ferramenta_revogar','membros_crm_operar','membros_ferramenta_pedir_exclusao','membros_ferramentas_admin','membros_proxima_resposta') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,service_role',f.assinatura);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.assinatura);
 END LOOP;
END $$;
-- Versões editoriais imutáveis. A aprovação aponta para uma versão exata.
CREATE TABLE public.membros_conteudo_versoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), material_id uuid NOT NULL REFERENCES public.membros_materiais(id),
 dados jsonb NOT NULL, base_hash bytea NOT NULL, autor uuid NOT NULL REFERENCES auth.users(id),
 estado text NOT NULL DEFAULT 'rascunho' CHECK(estado IN('rascunho','revisao','aprovado','publicado')),
 aprovado_por uuid REFERENCES auth.users(id), aprovado_em timestamptz, publicado_por uuid REFERENCES auth.users(id), publicado_em timestamptz,
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membros_conteudo_versoes_material ON public.membros_conteudo_versoes(material_id,criado_em DESC);
ALTER TABLE public.membros_conteudo_versoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membros_conteudo_versoes FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.membros_conteudo_versoes_ler(_material uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('autor_nome',p.full_name) ORDER BY v.criado_em DESC) FROM (SELECT id,material_id,dados,autor,estado,aprovado_em,publicado_em,criado_em FROM public.membros_conteudo_versoes WHERE material_id=_material ORDER BY criado_em DESC LIMIT 30) v JOIN public.profiles p ON p.id=v.autor),'[]'::jsonb);
END $$;
CREATE FUNCTION public.membros_conteudo_versionar(_material uuid,_acao text,_dados jsonb DEFAULT NULL,_versao uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE atual public.membros_materiais; v public.membros_conteudo_versoes; novo uuid; a public.membros_materiais;
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 SELECT * INTO atual FROM public.membros_materiais WHERE id=_material FOR UPDATE;
 IF atual.id IS NULL THEN RAISE EXCEPTION 'Material indisponível' USING ERRCODE='22023'; END IF;
 IF _acao='rascunhar' THEN
  IF _dados IS NULL OR pg_column_size(_dados)>600000 THEN RAISE EXCEPTION 'Conteúdo inválido' USING ERRCODE='22023'; END IF;
  a:=jsonb_populate_record(atual,_dados);
  IF a.id IS DISTINCT FROM atual.id OR a.produto_id IS DISTINCT FROM atual.produto_id OR a.titulo IS NULL OR length(btrim(a.titulo)) NOT BETWEEN 1 AND 180
   OR a.tipo IS NULL OR a.tipo NOT IN('texto','video','audio','pdf','arquivo') OR a.estado IS NULL OR a.estado NOT IN('rascunho','publicado','arquivado')
   OR (a.arquivo IS NOT NULL AND a.arquivo NOT LIKE atual.produto_id::text||'/'||atual.id::text||'/%') THEN RAISE EXCEPTION 'Confira o conteúdo e o arquivo deste material' USING ERRCODE='22023'; END IF;
  IF a.modulo_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.membros_modulos WHERE id=a.modulo_id AND produto_id=atual.produto_id) THEN RAISE EXCEPTION 'Módulo de outro produto' USING ERRCODE='22023'; END IF;
  IF a.aula_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.membros_materiais WHERE id=a.aula_id AND produto_id=atual.produto_id AND id<>atual.id AND aula_id IS NULL) THEN RAISE EXCEPTION 'Aula de outro produto' USING ERRCODE='22023'; END IF;
  INSERT INTO public.membros_conteudo_versoes(material_id,dados,base_hash,autor)
   VALUES(_material,jsonb_build_object('titulo',a.titulo,'tipo',a.tipo,'texto',a.texto,'arquivo',a.arquivo,'permite_download',a.permite_download,'estado',a.estado,'modulo_id',a.modulo_id,'aula_id',a.aula_id,'ordem',a.ordem),sha256(convert_to(to_jsonb(atual)::text,'UTF8')),auth.uid()) RETURNING id INTO novo;
  RETURN novo;
 END IF;
 SELECT * INTO v FROM public.membros_conteudo_versoes WHERE id=_versao AND material_id=_material FOR UPDATE;
 IF v.id IS NULL THEN RAISE EXCEPTION 'Versão indisponível' USING ERRCODE='22023'; END IF;
 IF _acao='enviar_revisao' AND v.estado='rascunho' THEN UPDATE public.membros_conteudo_versoes SET estado='revisao' WHERE id=v.id;
 ELSIF _acao='aprovar' AND v.estado='revisao' THEN UPDATE public.membros_conteudo_versoes SET estado='aprovado',aprovado_por=auth.uid(),aprovado_em=now() WHERE id=v.id;
 ELSIF _acao='publicar' AND v.estado='aprovado' THEN
  IF sha256(convert_to(to_jsonb(atual)::text,'UTF8'))<>v.base_hash THEN RAISE EXCEPTION 'O material mudou depois deste rascunho. Prepare uma nova versão antes de publicar.' USING ERRCODE='40001'; END IF;
  a:=jsonb_populate_record(atual,v.dados);
  UPDATE public.membros_materiais SET titulo=a.titulo,tipo=a.tipo,texto=a.texto,arquivo=a.arquivo,permite_download=a.permite_download,estado=a.estado,modulo_id=a.modulo_id,aula_id=a.aula_id,ordem=a.ordem WHERE id=atual.id;
  UPDATE public.membros_conteudo_versoes SET estado='publicado',publicado_por=auth.uid(),publicado_em=now() WHERE id=v.id;
 ELSE RAISE EXCEPTION 'Etapa de revisão inválida' USING ERRCODE='22023'; END IF;
 RETURN v.id;
END $$;
REVOKE ALL ON FUNCTION public.membros_conteudo_versoes_ler(uuid),public.membros_conteudo_versionar(uuid,text,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_conteudo_versoes_ler(uuid),public.membros_conteudo_versionar(uuid,text,jsonb,uuid) TO authenticated;
CREATE FUNCTION public.membros_crm_excluir_pedido(_usuario uuid,_produto uuid,_solicitado_em timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE contatos integer; negocios integer;
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.membros_pedidos_exclusao WHERE user_id=_usuario AND produto_id=_produto AND solicitado_em=_solicitado_em AND atendido_em IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de exclusão indisponível ou já atendido' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.membros_sessoes_ferramenta WHERE user_id=_usuario AND produto_id=_produto FOR UPDATE;
 DELETE FROM public.membros_crm_negocios WHERE user_id=_usuario AND produto_id=_produto; GET DIAGNOSTICS negocios=ROW_COUNT;
 DELETE FROM public.membros_crm_contatos WHERE user_id=_usuario AND produto_id=_produto; GET DIAGNOSTICS contatos=ROW_COUNT;
 UPDATE public.membros_pedidos_exclusao SET atendido_em=now() WHERE user_id=_usuario AND produto_id=_produto;
 INSERT INTO public.membros_ferramentas_historico(user_id,produto_id,ator,acao) VALUES(_usuario,_produto,auth.uid(),'exclusao_solicitada_atendida');
 RETURN jsonb_build_object('contatos',contatos,'negocios',negocios);
END $$;
REVOKE ALL ON FUNCTION public.membros_crm_excluir_pedido(uuid,uuid,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_crm_excluir_pedido(uuid,uuid,timestamptz) TO authenticated;
CREATE FUNCTION public.membros_ferramenta_upgrade_preparar(_produto uuid,_nome text,_recursos text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.membros_admin() THEN RAISE EXCEPTION 'Somente administração' USING ERRCODE='42501'; END IF;
 IF _nome IS NULL OR length(btrim(_nome)) NOT BETWEEN 1 AND 80 OR _recursos IS NULL OR cardinality(_recursos)>20 OR EXISTS(SELECT 1 FROM unnest(_recursos) r WHERE r IS NULL OR length(btrim(r)) NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'Confira o nome e os recursos do rascunho mensal' USING ERRCODE='22023'; END IF;
 UPDATE public.membros_ferramentas SET upgrade_mensal=jsonb_build_object('nome',btrim(_nome),'recursos',to_jsonb(_recursos),'estado','rascunho','cobranca_ativa',false) WHERE produto_id=_produto;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vincule a ferramenta ao produto primeiro' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.membros_ferramenta_upgrade_preparar(uuid,text,text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.membros_ferramenta_upgrade_preparar(uuid,text,text[]) TO authenticated;
COMMIT;
