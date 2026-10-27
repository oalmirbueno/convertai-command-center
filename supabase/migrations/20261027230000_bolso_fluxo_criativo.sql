-- PREPARADA, NÃO APLICADA. Requer aprovação de implantação.
-- Expande os pedidos existentes sem alterar tarifas, carteiras, pagamentos ou reservas.
-- Reversão operacional: bolso_admin_recursos_criativos(false). Não remover dados/lançamentos.
BEGIN;

ALTER TABLE public.bolso_config ADD COLUMN recursos_criativos boolean NOT NULL DEFAULT false;
ALTER TABLE public.bolso_jobs
  ADD COLUMN natureza text CHECK (natureza IN ('briefing','legenda','imagem','ajuste')),
  ADD COLUMN entrada_criativa jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN contexto_criativo jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.bolso_referencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  campanha_id uuid NOT NULL,
  caminho text NOT NULL UNIQUE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 160),
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/webp')),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  criada_em timestamptz NOT NULL DEFAULT now(),
  confirmada_em timestamptz,
  removida_em timestamptz,
  FOREIGN KEY (campanha_id,user_id) REFERENCES public.bolso_campanhas(id,user_id),
  CHECK (caminho = user_id::text || '/' || campanha_id::text || '/referencias/' || id::text ||
    CASE mime WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '.webp' END)
);
ALTER TABLE public.bolso_referencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bolso_referencias FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.bolso_referencias TO service_role;

CREATE FUNCTION public.bolso_admin_recursos_criativos(_habilitar boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM bolso_privado.exigir_admin();
  UPDATE public.bolso_config SET recursos_criativos=COALESCE(_habilitar,false) WHERE id;
  INSERT INTO public.bolso_auditoria(ator,acao,alvo,dados) VALUES(auth.uid(),'recursos_criativos','config',jsonb_build_object('habilitado',COALESCE(_habilitar,false)));
END $$;

ALTER FUNCTION public.bolso_estado() RENAME TO bolso_estado_base_criativo;
REVOKE ALL ON FUNCTION public.bolso_estado_base_criativo() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.bolso_estado() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e jsonb := public.bolso_estado_base_criativo(); ligado boolean;
BEGIN
  ligado := (bolso_privado.config()).recursos_criativos AND e->>'modo'='real';
  RETURN e || jsonb_build_object('recursos_criativos',jsonb_build_object(
    'briefing',COALESCE(ligado,false),'legenda',COALESCE(ligado,false),
    'referencias',COALESCE(ligado,false),'ajuste',COALESCE(ligado,false)));
END $$;

CREATE FUNCTION public.bolso_referencia_registrar(_campanha uuid,_nome text,_mime text,_bytes integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); n integer; r public.bolso_referencias; novo uuid := gen_random_uuid();
BEGIN
  IF NOT (bolso_privado.config()).recursos_criativos OR (bolso_privado.modo_do_membro(u)->>'modo') IS DISTINCT FROM 'real' THEN
    RAISE EXCEPTION 'Referências exigem acesso ativo e geração real disponível' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.bolso_campanhas WHERE id=_campanha AND user_id=u AND NOT arquivada FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE='42501'; END IF;
  IF _mime NOT IN ('image/png','image/jpeg','image/webp') OR _bytes IS NULL OR _bytes NOT BETWEEN 1 AND 5242880
    OR length(btrim(COALESCE(_nome,''))) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'Envie uma imagem PNG, JPEG ou WEBP de até 5 MB' USING ERRCODE='22023';
  END IF;
  -- Registro e limpeza usam a mesma trava da campanha. Abas fechadas antes de concluir o upload
  -- não ocupam os três slots para sempre; arquivos confirmados nunca expiram por esta regra.
  UPDATE public.bolso_referencias SET removida_em=now()
    WHERE campanha_id=_campanha AND user_id=u AND removida_em IS NULL AND confirmada_em IS NULL
      AND criada_em <= now()-interval '15 minutes';
  SELECT count(*) INTO n FROM public.bolso_referencias WHERE campanha_id=_campanha AND user_id=u AND removida_em IS NULL;
  IF n>=3 THEN
    IF EXISTS(SELECT 1 FROM public.bolso_referencias WHERE campanha_id=_campanha AND user_id=u AND removida_em IS NULL AND confirmada_em IS NULL) THEN
      RAISE EXCEPTION 'Há envios em andamento. Envios interrompidos liberam espaço após 15 minutos.' USING ERRCODE='53400';
    END IF;
    RAISE EXCEPTION 'Use até três referências por campanha' USING ERRCODE='53400';
  END IF;
  INSERT INTO public.bolso_referencias(id,user_id,campanha_id,caminho,nome,mime,bytes)
  VALUES(novo,u,_campanha,u::text||'/'||_campanha::text||'/referencias/'||novo::text||CASE _mime WHEN 'image/png' THEN '.png' WHEN 'image/jpeg' THEN '.jpg' ELSE '.webp' END,btrim(_nome),_mime,_bytes)
  RETURNING * INTO r;
  RETURN jsonb_build_object('id',r.id,'caminho',r.caminho,'nome',r.nome,'mime',r.mime,'bytes',r.bytes);
END $$;

CREATE FUNCTION public.bolso_referencias_listar(_campanha uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'caminho',r.caminho,'nome',r.nome,'mime',r.mime,'bytes',r.bytes) ORDER BY criada_em),'[]'::jsonb)
  FROM public.bolso_referencias r WHERE r.campanha_id=_campanha AND r.user_id=bolso_privado.exigir_membro() AND r.removida_em IS NULL AND r.confirmada_em IS NOT NULL
$$;
CREATE FUNCTION public.bolso_referencia_remover(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.bolso_referencias SET removida_em=now() WHERE id=_id AND user_id=bolso_privado.exigir_membro() AND removida_em IS NULL;
END $$;

CREATE FUNCTION public.bolso_pedir_criativo(_campanha uuid,_natureza text,_formato text,_chave text,_tarifa_vista integer,_entrada jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); pedido_resultado jsonb; j public.bolso_jobs; camp public.bolso_campanhas;
  marca public.bolso_marcas; tipo_ text; entrada_ jsonb; refs jsonb; ref text; n integer; campo text; versao_original integer; contexto_original jsonb;
BEGIN
  IF _natureza IS NULL OR _natureza NOT IN ('briefing','legenda','imagem','ajuste') THEN RAISE EXCEPTION 'Ação inválida' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(_entrada) IS DISTINCT FROM 'object' OR (_entrada-ARRAY['ideia','ajuste','arte_origem','referencias'])<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Dados do pedido inválidos' USING ERRCODE='22023';
  END IF;
  FOREACH campo IN ARRAY ARRAY['ideia','ajuste','arte_origem'] LOOP
    IF _entrada ? campo AND jsonb_typeof(_entrada->campo) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Dados do pedido inválidos' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF length(COALESCE(_entrada->>'ideia',''))>1500 OR length(COALESCE(_entrada->>'ajuste',''))>1500 THEN
    RAISE EXCEPTION 'Use até 1500 caracteres para a ideia ou ajuste' USING ERRCODE='22023';
  END IF;
  refs := COALESCE(_entrada->'referencias','[]'::jsonb);
  IF jsonb_typeof(refs) IS DISTINCT FROM 'array' OR jsonb_array_length(refs)>3 THEN RAISE EXCEPTION 'Use até três referências' USING ERRCODE='22023'; END IF;
  entrada_ := jsonb_build_object('ideia',btrim(COALESCE(_entrada->>'ideia','')),'ajuste',btrim(COALESCE(_entrada->>'ajuste','')),
    'arte_origem',COALESCE(_entrada->>'arte_origem',''),'referencias',refs);
  IF _natureza='briefing' AND entrada_->>'ideia'='' THEN RAISE EXCEPTION 'Conte a sua ideia para a campanha' USING ERRCODE='22023'; END IF;
  IF _natureza='ajuste' AND (entrada_->>'ajuste'='' OR entrada_->>'arte_origem'='') THEN RAISE EXCEPTION 'Escolha a arte e descreva o ajuste' USING ERRCODE='22023'; END IF;
  IF (_natureza<>'briefing' AND entrada_->>'ideia'<>'') OR (_natureza<>'ajuste' AND (entrada_->>'ajuste'<>'' OR entrada_->>'arte_origem'<>'')) THEN
    RAISE EXCEPTION 'Dados incompatíveis com a ação escolhida' USING ERRCODE='22023';
  END IF;
  IF _natureza IN ('briefing','legenda') AND (jsonb_array_length(refs)>0 OR entrada_->>'ajuste'<>'' OR entrada_->>'arte_origem'<>'') THEN
    RAISE EXCEPTION 'Referências visuais são usadas na geração da imagem' USING ERRCODE='22023';
  END IF;
  tipo_ := CASE WHEN _natureza IN ('briefing','legenda') THEN 'texto' ELSE 'imagem' END;
  -- A mesma ordem de travas da admissão existente. Replay depende da intenção registrada,
  -- nunca da copy selecionada posteriormente na campanha (em especial nos ajustes).
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:admissao-global',7));
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:'||u::text,7));
  SELECT * INTO j FROM public.bolso_jobs WHERE user_id=u AND chave=_chave FOR UPDATE;
  IF j.id IS NOT NULL THEN
    IF j.campanha_id IS DISTINCT FROM _campanha OR j.tipo IS DISTINCT FROM tipo_ OR j.formato IS DISTINCT FROM _formato
      OR j.natureza IS DISTINCT FROM _natureza OR j.entrada_criativa IS DISTINCT FROM entrada_ THEN
      RAISE EXCEPTION 'Esta chave já foi usada em outro pedido' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('job_id',j.id,'estado',j.estado,'repetido',true);
  END IF;
  -- Reutiliza toda a admissão existente: trava global, saldo, limites, tarifa vista e reserva atômica.
  pedido_resultado := public.bolso_pedir(_campanha,tipo_,_formato,_chave,_tarifa_vista);
  SELECT * INTO j FROM public.bolso_jobs WHERE id=(pedido_resultado->>'job_id')::uuid FOR UPDATE;
  IF (pedido_resultado->>'repetido')::boolean THEN
    IF j.natureza IS DISTINCT FROM _natureza OR j.entrada_criativa IS DISTINCT FROM entrada_ THEN
      RAISE EXCEPTION 'Esta chave já foi usada em outro pedido' USING ERRCODE='22023';
    END IF;
    RETURN pedido_resultado;
  END IF;
  IF NOT (bolso_privado.config()).recursos_criativos OR j.provedor<>'openrouter' OR j.carteira<>'real' THEN
    RAISE EXCEPTION 'Este recurso ainda não está disponível na sua conta' USING ERRCODE='42501';
  END IF;
  -- O contrato comercial fica no servidor. Não aceita custo reduzido pelo cliente.
  IF j.tarifa<>(CASE WHEN tipo_='texto' THEN 1 ELSE 5 END) THEN RAISE EXCEPTION 'A política deste acesso precisa ser revisada' USING ERRCODE='42501'; END IF;
  SELECT * INTO camp FROM public.bolso_campanhas WHERE id=_campanha AND user_id=u FOR UPDATE;
  SELECT * INTO marca FROM public.bolso_marcas WHERE id=camp.marca_id AND user_id=u;
  IF _natureza='ajuste' THEN
    SELECT a.versao_campanha,origem.contexto_criativo INTO versao_original,contexto_original
      FROM public.bolso_arquivos a JOIN public.bolso_jobs origem ON origem.id=a.job_id AND origem.user_id=a.user_id AND origem.campanha_id=a.campanha_id
      WHERE a.id=(entrada_->>'arte_origem')::uuid AND a.user_id=u AND a.campanha_id=_campanha;
    IF NOT FOUND THEN RAISE EXCEPTION 'Arte não encontrada nesta campanha' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT count(DISTINCT x) INTO n FROM jsonb_array_elements_text(refs) x;
  IF n<>jsonb_array_length(refs) THEN RAISE EXCEPTION 'Referência repetida' USING ERRCODE='22023'; END IF;
  FOR ref IN SELECT jsonb_array_elements_text(refs) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.bolso_referencias WHERE id=ref::uuid AND user_id=u AND campanha_id=_campanha AND removida_em IS NULL AND confirmada_em IS NOT NULL) THEN
      RAISE EXCEPTION 'Referência não encontrada nesta campanha' USING ERRCODE='42501';
    END IF;
  END LOOP;
  UPDATE public.bolso_jobs SET natureza=_natureza,entrada_criativa=entrada_,
    versao_campanha=CASE WHEN _natureza='ajuste' THEN versao_original ELSE versao_campanha END,
    impressao=CASE WHEN _natureza='ajuste' THEN md5(concat_ws('|',_campanha,tipo_,COALESCE(_formato,''),versao_original::text)) ELSE impressao END,
    contexto_criativo=CASE WHEN _natureza='ajuste' THEN
      CASE WHEN jsonb_typeof(contexto_original->'briefing')='object' AND jsonb_typeof(contexto_original->'marca')='object' THEN contexto_original
        ELSE jsonb_build_object('briefing',jsonb_build_object('tipo','venda','produto',''),'marca',jsonb_build_object('nome',''),'origem_sem_snapshot',true) END
      ELSE jsonb_build_object(
    'briefing',camp.briefing,'campanha_versao',camp.versao,
    'marca',jsonb_build_object('nome',marca.nome,'descricao',marca.descricao,'publico',marca.publico,'regiao',marca.regiao,'tom',marca.tom,'cores',to_jsonb(marca.cores))) END WHERE id=j.id;
  RETURN pedido_resultado;
END $$;

ALTER FUNCTION public.bolso_trabalho_pegar(uuid,integer) RENAME TO bolso_trabalho_pegar_base_criativo;
REVOKE ALL ON FUNCTION public.bolso_trabalho_pegar_base_criativo(uuid,integer) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.bolso_trabalho_pegar(_job uuid DEFAULT NULL,_lease_segundos integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p jsonb := public.bolso_trabalho_pegar_base_criativo(_job,_lease_segundos); j public.bolso_jobs;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO j FROM public.bolso_jobs WHERE id=(p->'job'->>'id')::uuid;
  IF j.natureza IS NULL THEN RETURN p; END IF;
  RETURN p || jsonb_build_object('job',(p->'job')||jsonb_build_object('natureza',j.natureza,'entrada',j.entrada_criativa),
    'briefing',j.contexto_criativo->'briefing','marca',j.contexto_criativo->'marca');
END $$;

ALTER FUNCTION public.bolso_trabalho_concluir(uuid,integer,jsonb,jsonb,jsonb) RENAME TO bolso_trabalho_concluir_base_criativo;
REVOKE ALL ON FUNCTION public.bolso_trabalho_concluir_base_criativo(uuid,integer,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.bolso_trabalho_concluir(_job uuid,_tentativa integer,_resultado jsonb,_arquivo jsonb DEFAULT NULL,_custo jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.bolso_jobs; b jsonb;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  SELECT * INTO j FROM public.bolso_jobs WHERE id=_job FOR UPDATE;
  IF j.natureza IS DISTINCT FROM 'briefing' THEN RETURN public.bolso_trabalho_concluir_base_criativo(_job,_tentativa,_resultado,_arquivo,_custo); END IF;
  IF j.estado<>'processando' OR j.tentativas<>_tentativa THEN RETURN jsonb_build_object('aceito',false,'estado',j.estado); END IF;
  b := bolso_privado.limpar_briefing(_resultado->'briefing');
  -- É uma proposta: aplicar e salvar continua exigindo a versão atual da campanha no RPC existente.
  UPDATE public.bolso_jobs SET estado='concluido',resultado=jsonb_build_object('briefing',b,'aplicado',false),
    lease_ate=NULL,erro=NULL,concluido_em=now(),atualizado_em=now() WHERE id=j.id;
  PERFORM bolso_privado.capturar(j);
  IF _custo IS NOT NULL AND (_custo->>'custo_usd') IS NOT NULL THEN
    INSERT INTO public.bolso_custos_fornecedor(job_id,provedor,modelo,custo_usd) VALUES(j.id,j.provedor,_custo->>'modelo',(_custo->>'custo_usd')::numeric)
    ON CONFLICT(job_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('aceito',true,'estado','concluido');
END $$;

CREATE FUNCTION public.bolso_criativo_resultado(_job uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.bolso_jobs;
BEGIN
  SELECT * INTO j FROM public.bolso_jobs WHERE id=_job AND user_id=bolso_privado.exigir_membro();
  IF j.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('estado',j.estado,'natureza',j.natureza,'erro',j.erro)
    || CASE WHEN j.estado='concluido' AND j.natureza='briefing' THEN j.resultado
      WHEN j.estado='concluido' AND j.tipo='texto' THEN jsonb_build_object('conteudo',j.resultado) ELSE '{}'::jsonb END;
END $$;

-- A proposta continua recuperável pelo histórico da campanha, inclusive depois de recarregar a tela.
ALTER FUNCTION public.bolso_campanha_ler(uuid) RENAME TO bolso_campanha_ler_base_criativo;
REVOKE ALL ON FUNCTION public.bolso_campanha_ler_base_criativo(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.bolso_campanha_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb := public.bolso_campanha_ler_base_criativo(_id); u uuid := bolso_privado.exigir_membro();
BEGIN
  RETURN jsonb_set(c,'{jobs}',COALESCE((SELECT jsonb_agg(item || jsonb_build_object('natureza',j.natureza) ORDER BY j.criado_em DESC)
    FROM jsonb_array_elements(c->'jobs') item JOIN public.bolso_jobs j ON j.id=(item->>'id')::uuid
    WHERE j.user_id=u AND j.campanha_id=_id),'[]'::jsonb));
END $$;

-- O extrato continua imutável. O rótulo é derivado da natureza do job registrado pelo servidor.
CREATE OR REPLACE FUNCTION public.bolso_extrato(_limite integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid := bolso_privado.exigir_membro();
BEGIN
  PERFORM bolso_privado.expirar(u);
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.criado_em DESC) FROM (
    SELECT c.id,c.carteira,c.tipo,c.quantidade,c.delta_disponivel,c.delta_reservado,
      c.descricao || CASE j.natureza WHEN 'briefing' THEN ' · Preparação de campanha' WHEN 'legenda' THEN ' · Copy e legenda'
        WHEN 'ajuste' THEN ' · Ajuste de arte' WHEN 'imagem' THEN ' · Nova arte' ELSE '' END AS descricao,
      c.criado_em,c.job_id,j.natureza FROM public.bolso_creditos c LEFT JOIN public.bolso_jobs j ON j.id=c.job_id AND j.user_id=c.user_id
      WHERE c.user_id=u ORDER BY c.criado_em DESC,c.id DESC LIMIT least(greatest(_limite,1),200)) x),'[]'::jsonb);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['bolso_estado()','bolso_admin_recursos_criativos(boolean)','bolso_referencia_registrar(uuid,text,text,integer)',
    'bolso_referencias_listar(uuid)','bolso_referencia_remover(uuid)','bolso_pedir_criativo(uuid,text,text,text,integer,jsonb)','bolso_criativo_resultado(uuid)','bolso_campanha_ler(uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC,anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO authenticated';
  END LOOP;
  FOREACH f IN ARRAY ARRAY['bolso_trabalho_pegar(uuid,integer)','bolso_trabalho_concluir(uuid,integer,jsonb,jsonb,jsonb)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||f||' FROM PUBLIC,anon,authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||f||' TO service_role';
  END LOOP;
END $$;
COMMIT;
