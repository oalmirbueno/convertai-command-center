-- Incremento sobre o schema Bolso já existente. Não reaplica o baseline.
-- Plano/preflight/rollback: docs/membros/BOLSO-RECARGAS-PLANO.md
-- Sem concessão, seed, cobrança, alteração de gates ou publicação de ofertas.
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.bolso_creditos') IS NULL OR to_regprocedure('public.bolso_pedir(uuid,text,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Baseline Bolso ausente. Parar e conferir o preflight; não reaplicar histórico automaticamente.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bolso_jobs WHERE estado IN ('na_fila','processando','incerto')) THEN
    RAISE EXCEPTION 'Concluir ou reconciliar a fila Bolso antes deste incremento.';
  END IF;
END $$;

ALTER TABLE public.bolso_jobs DROP CONSTRAINT bolso_jobs_provedor_check;
ALTER TABLE public.bolso_jobs ADD CONSTRAINT bolso_jobs_provedor_check CHECK (provedor IN ('simulado','openai','openrouter'));

-- Cada trabalho pode usar vários lotes. O histórico antigo já é um lote por job.
-- Mantém exclusão captura/liberação PARA CADA lote e imutabilidade do extrato.
DROP INDEX public.bolso_creditos_uma_vez_por_job;
DROP INDEX public.bolso_creditos_fecha_uma_vez;
DROP INDEX public.bolso_creditos_expiracao_unica;
CREATE UNIQUE INDEX bolso_creditos_uma_vez_por_job_lote ON public.bolso_creditos(job_id, direito_id, tipo) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX bolso_creditos_fecha_lote_uma_vez ON public.bolso_creditos(job_id, direito_id) WHERE tipo IN ('captura','liberacao');
-- Uma reserva pode voltar depois da primeira expiração. A soma, sob lock, garante
-- a idempotência da expiração; uma UNIQUE por direito impediria esse encerramento.
CREATE INDEX bolso_creditos_por_lote ON public.bolso_creditos(direito_id, tipo);

CREATE OR REPLACE FUNCTION bolso_privado.validar_lancamento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.bolso_direitos; j public.bolso_jobs; r public.bolso_creditos; total bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || NEW.user_id::text, 7));
  SELECT * INTO d FROM public.bolso_direitos WHERE id = NEW.direito_id;
  IF d.id IS NULL OR d.user_id <> NEW.user_id OR d.carteira <> NEW.carteira THEN
    RAISE EXCEPTION 'Lote de créditos não pertence a esta conta e carteira' USING ERRCODE='42501';
  END IF;
  IF NEW.job_id IS NOT NULL THEN
    SELECT * INTO j FROM public.bolso_jobs WHERE id = NEW.job_id;
    IF j.id IS NULL OR j.user_id <> NEW.user_id OR j.carteira <> NEW.carteira THEN
      RAISE EXCEPTION 'Pedido não pertence a esta conta e carteira' USING ERRCODE='42501';
    END IF;
    IF NEW.tipo = 'reserva' THEN
      IF EXISTS (SELECT 1 FROM public.bolso_creditos WHERE job_id=j.id AND tipo IN ('captura','liberacao')) THEN
        RAISE EXCEPTION 'Pedido já teve a reserva encerrada' USING ERRCODE='22023';
      END IF;
      SELECT COALESCE(sum(quantidade),0) INTO total FROM public.bolso_creditos WHERE job_id=j.id AND tipo='reserva';
      IF total + NEW.quantidade > j.tarifa THEN RAISE EXCEPTION 'Reserva excede a tarifa do pedido' USING ERRCODE='22023'; END IF;
      SELECT COALESCE(sum(delta_disponivel),0) INTO total FROM public.bolso_creditos WHERE direito_id=d.id;
      IF total < NEW.quantidade OR d.revogado_em IS NOT NULL OR d.inicio > now() OR d.fim <= now() THEN
        RAISE EXCEPTION 'Saldo insuficiente ou lote inativo' USING ERRCODE='53400';
      END IF;
    ELSE
      SELECT * INTO r FROM public.bolso_creditos WHERE job_id=j.id AND direito_id=d.id AND tipo='reserva';
      IF r.id IS NULL OR r.quantidade <> NEW.quantidade THEN
        RAISE EXCEPTION 'Encerramento precisa corresponder à reserva original do lote' USING ERRCODE='22023';
      END IF;
    END IF;
  ELSIF NEW.tipo IN ('expiracao','estorno') THEN
    SELECT COALESCE(sum(delta_disponivel),0) INTO total FROM public.bolso_creditos WHERE direito_id=d.id;
    IF NEW.quantidade > total THEN RAISE EXCEPTION 'Estorno excede o saldo disponível do lote' USING ERRCODE='22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bolso_creditos_validar_lote BEFORE INSERT ON public.bolso_creditos
FOR EACH ROW EXECUTE FUNCTION bolso_privado.validar_lancamento();

CREATE OR REPLACE FUNCTION bolso_privado.expirar(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d record; sobra integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || _user::text, 7));
  FOR d IN SELECT id, carteira, revogado_em FROM public.bolso_direitos
    WHERE user_id = _user AND (fim <= now() OR revogado_em IS NOT NULL) ORDER BY id FOR UPDATE LOOP
    SELECT COALESCE(sum(delta_disponivel), 0) INTO sobra FROM public.bolso_creditos WHERE direito_id = d.id;
    IF sobra > 0 THEN
      INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, descricao)
      VALUES (_user, d.id, d.carteira, CASE WHEN d.revogado_em IS NOT NULL THEN 'estorno' ELSE 'expiracao' END, sobra, -sobra, 0,
        CASE WHEN d.revogado_em IS NOT NULL THEN 'Créditos estornados com o acesso' ELSE 'Créditos vencidos com o acesso' END)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION bolso_privado.saldo(_user uuid, _carteira text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'disponivel', COALESCE((SELECT sum(c.delta_disponivel) FROM public.bolso_creditos c JOIN public.bolso_direitos d ON d.id = c.direito_id
      WHERE c.user_id = _user AND c.carteira = _carteira AND d.inicio <= now() AND d.fim > now() AND d.revogado_em IS NULL), 0),
    'reservado', COALESCE((SELECT sum(delta_reservado) FROM public.bolso_creditos WHERE user_id = _user AND carteira = _carteira), 0))
$$;

CREATE OR REPLACE FUNCTION bolso_privado.direito_ativo(_user uuid, _carteira text) RETURNS public.bolso_direitos
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.bolso_direitos
  WHERE user_id = _user AND carteira = _carteira AND revogado_em IS NULL AND inicio <= now() AND fim > now() AND tipo <> 'recarga'
  ORDER BY fim DESC, criado_em DESC, id LIMIT 1
$$;

-- Acesso vencido não esconde saldo real de recargas ainda válidas.
CREATE OR REPLACE FUNCTION public.bolso_estado() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); c public.bolso_config := bolso_privado.config();
  admin boolean := public.membros_admin(); m jsonb; v_carteira text; d public.bolso_direitos; p public.bolso_politicas;
BEGIN
  IF NOT c.modulo_exposto AND NOT admin
    AND NOT EXISTS (SELECT 1 FROM public.bolso_direitos WHERE user_id = u)
    AND NOT EXISTS (SELECT 1 FROM public.bolso_campanhas WHERE user_id = u) THEN
    RETURN jsonb_build_object('exposto', false);
  END IF;
  PERFORM bolso_privado.expirar(u);
  m := bolso_privado.modo_do_membro(u);
  v_carteira := COALESCE(m ->> 'carteira', CASE WHEN EXISTS (SELECT 1 FROM public.bolso_direitos WHERE user_id=u AND carteira='real') THEN 'real' ELSE 'teste' END);
  d := bolso_privado.direito_ativo(u, v_carteira);
  IF d.id IS NOT NULL THEN SELECT * INTO p FROM public.bolso_politicas WHERE id = d.politica_id;
  ELSIF v_carteira = 'teste' AND admin THEN SELECT * INTO p FROM public.bolso_politicas WHERE teste AND estado <> 'arquivado' ORDER BY versao DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'exposto', true,
    'admin', admin,
    'modo', m ->> 'modo',
    'motivo', m ->> 'motivo',
    'carteira', v_carteira,
    'direito', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('tipo', d.tipo, 'origem', d.origem, 'inicio', d.inicio, 'fim', d.fim) END,
    'saldo', bolso_privado.saldo(u, v_carteira),
    'politica', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('versao', p.versao, 'teste', p.teste,
      'tarifa_texto', (p.dados ->> 'tarifa_texto')::int, 'tarifa_imagem', (p.dados ->> 'tarifa_imagem')::int, 'formatos', p.dados -> 'formatos') END,
    'limites_configurados', c.limites IS NOT NULL,
    'destino_agencia', c.destino_agencia
  );
END $$;

CREATE OR REPLACE FUNCTION public.bolso_pedir(_campanha uuid, _tipo text, _formato text, _chave text, _tarifa_vista integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); c public.bolso_config := bolso_privado.config(); m jsonb; v_carteira text;
  d public.bolso_direitos; p public.bolso_politicas; v_tarifa integer; v_impressao text; existente public.bolso_jobs; v_versao integer;
  disp integer; novo uuid; lim jsonb; n integer; lote record; falta integer; usar integer;
BEGIN
  IF _tipo NOT IN ('texto', 'imagem') THEN RAISE EXCEPTION 'Tipo de pedido inválido' USING ERRCODE = '22023'; END IF;
  IF (_tipo = 'imagem') <> (_formato IS NOT NULL) THEN RAISE EXCEPTION 'Formato só vale para arte' USING ERRCODE = '22023'; END IF;
  IF _chave IS NULL OR length(_chave) NOT BETWEEN 8 AND 120 THEN RAISE EXCEPTION 'Chave do pedido inválida' USING ERRCODE = '22023'; END IF;
  -- Serializa admissão para não exceder o teto global com duas contas simultâneas.
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:admissao-global', 7));
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || u::text, 7));

  SELECT versao_escolhida INTO v_versao FROM public.bolso_campanhas WHERE id = _campanha AND user_id = u AND NOT arquivada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE = '42501'; END IF;
  v_impressao := md5(concat_ws('|', _campanha, _tipo, COALESCE(_formato, ''), CASE WHEN _tipo = 'imagem' THEN COALESCE(v_versao::text, '') ELSE '' END));

  -- A chave é conferida antes de qualquer outra regra: repetir devolve o mesmo job; outro pedido é recusado.
  SELECT * INTO existente FROM public.bolso_jobs WHERE user_id = u AND chave = _chave;
  IF existente.id IS NOT NULL THEN
    IF existente.impressao <> v_impressao THEN RAISE EXCEPTION 'Esta chave já foi usada em outro pedido' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('job_id', existente.id, 'estado', existente.estado, 'repetido', true);
  END IF;
  IF _tipo = 'imagem' AND v_versao IS NULL THEN RAISE EXCEPTION 'Escolha uma versão do texto antes de pedir a arte' USING ERRCODE = '22023'; END IF;

  PERFORM bolso_privado.expirar(u);
  m := bolso_privado.modo_do_membro(u);
  IF m ->> 'modo' NOT IN ('real', 'simulado') THEN RAISE EXCEPTION '%', m ->> 'motivo' USING ERRCODE = '42501'; END IF;
  v_carteira := m ->> 'carteira';
  lim := c.limites;
  IF lim IS NULL OR (lim ->> 'paralelo_por_usuario') IS NULL OR (lim ->> 'pedidos_por_dia_usuario') IS NULL OR (lim ->> 'teto_global_dia') IS NULL THEN
    RAISE EXCEPTION 'Os limites do estúdio ainda não foram configurados pela administração' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO n FROM public.bolso_jobs WHERE user_id = u AND estado IN ('na_fila', 'processando');
  IF n >= (lim ->> 'paralelo_por_usuario')::int THEN RAISE EXCEPTION 'Espere o pedido em andamento terminar' USING ERRCODE = '53400'; END IF;
  SELECT count(*) INTO n FROM public.bolso_jobs WHERE user_id = u AND criado_em > now() - interval '1 day';
  IF n >= (lim ->> 'pedidos_por_dia_usuario')::int THEN RAISE EXCEPTION 'Você chegou ao limite de pedidos de hoje. Amanhã libera de novo.' USING ERRCODE = '53400'; END IF;
  SELECT count(*) INTO n FROM public.bolso_jobs WHERE criado_em > now() - interval '1 day' AND carteira = 'real';
  IF v_carteira = 'real' AND n >= (lim ->> 'teto_global_dia')::int THEN RAISE EXCEPTION 'O estúdio atingiu o limite do dia. Tente amanhã.' USING ERRCODE = '53400'; END IF;

  -- O acesso define tarifa e formatos. Recarga é apenas um lote de créditos.
  d := bolso_privado.direito_ativo(u, v_carteira);
  IF d.id IS NULL AND v_carteira = 'teste' AND public.membros_admin() THEN
    RAISE EXCEPTION 'Conceda créditos de teste a você mesmo na administração do estúdio' USING ERRCODE = '42501';
  END IF;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Seu acesso ao estúdio não está ativo' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.bolso_politicas WHERE id = d.politica_id;
  IF v_carteira = 'real' AND (p.estado <> 'aprovado' OR p.teste) THEN RAISE EXCEPTION 'A política comercial deste acesso não está aprovada' USING ERRCODE = '42501'; END IF;
  IF _tipo = 'imagem' AND NOT (p.dados -> 'formatos') ? _formato THEN RAISE EXCEPTION 'Formato não incluído no seu acesso' USING ERRCODE = '22023'; END IF;
  v_tarifa := CASE WHEN _tipo = 'texto' THEN (p.dados ->> 'tarifa_texto')::int ELSE (p.dados ->> 'tarifa_imagem')::int END;
  IF _tarifa_vista IS DISTINCT FROM v_tarifa THEN
    RAISE EXCEPTION 'O custo mudou para % crédito(s). Confira e confirme de novo.', v_tarifa USING ERRCODE = '40001';
  END IF;
  SELECT (bolso_privado.saldo(u, v_carteira) ->> 'disponivel')::integer INTO disp;
  IF disp < v_tarifa THEN RAISE EXCEPTION 'Saldo insuficiente: este pedido usa % crédito(s) e você tem %.', v_tarifa, disp USING ERRCODE = '53400'; END IF;

  INSERT INTO public.bolso_jobs (user_id, campanha_id, tipo, formato, versao_campanha, estado, provedor, carteira, direito_id, politica_id, tarifa, chave, impressao)
  VALUES (u, _campanha, _tipo, _formato, CASE WHEN _tipo = 'imagem' THEN v_versao END, 'na_fila',
    CASE WHEN m ->> 'modo' = 'real' THEN 'openrouter' ELSE 'simulado' END, v_carteira, d.id, p.id, v_tarifa, _chave, v_impressao)
  RETURNING id INTO novo;
  falta := v_tarifa;
  -- FIFO por vencimento; ignorar lotes vazios e dividir a reserva quando preciso.
  FOR lote IN SELECT dd.id, dd.fim, COALESCE(sum(cr.delta_disponivel),0)::integer AS saldo
    FROM public.bolso_direitos dd LEFT JOIN public.bolso_creditos cr ON cr.direito_id=dd.id
    WHERE dd.user_id=u AND dd.carteira=v_carteira AND dd.inicio<=now() AND dd.fim>now() AND dd.revogado_em IS NULL
    GROUP BY dd.id HAVING COALESCE(sum(cr.delta_disponivel),0)>0 ORDER BY dd.fim, dd.id LOOP
    EXIT WHEN falta=0;
    usar := least(falta,lote.saldo);
    INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado,job_id,descricao,ator)
    VALUES(u,lote.id,v_carteira,'reserva',usar,-usar,usar,novo,
      CASE WHEN _tipo='texto' THEN 'Reserva: texto da campanha' ELSE 'Reserva: arte ' || _formato END,u);
    falta := falta-usar;
  END LOOP;
  IF falta<>0 THEN RAISE EXCEPTION 'Saldo alterado. Atualize seus créditos e tente novamente.' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('job_id', novo, 'estado', 'na_fila', 'repetido', false, 'tarifa', v_tarifa, 'provedor', CASE WHEN m ->> 'modo' = 'real' THEN 'openrouter' ELSE 'simulado' END);
END $$;

CREATE OR REPLACE FUNCTION bolso_privado.liberar(_job public.bolso_jobs, _descricao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || _job.user_id::text,7));
  INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado,job_id,descricao)
  SELECT r.user_id,r.direito_id,r.carteira,'liberacao',r.quantidade,r.quantidade,-r.quantidade,r.job_id,left(_descricao,300)
  FROM public.bolso_creditos r WHERE r.job_id=_job.id AND r.tipo='reserva'
    AND NOT EXISTS(SELECT 1 FROM public.bolso_creditos f WHERE f.job_id=r.job_id AND f.direito_id=r.direito_id AND f.tipo IN ('captura','liberacao'))
  ORDER BY r.direito_id ON CONFLICT DO NOTHING;
  -- Se o lote venceu ou foi estornado durante a geração, o saldo devolvido
  -- é encerrado no mesmo instante. Não ressuscita créditos nem acesso.
  PERFORM bolso_privado.expirar(_job.user_id);
END $$;

CREATE OR REPLACE FUNCTION bolso_privado.capturar(_job public.bolso_jobs) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || _job.user_id::text,7));
  INSERT INTO public.bolso_creditos(user_id,direito_id,carteira,tipo,quantidade,delta_disponivel,delta_reservado,job_id,descricao)
  SELECT r.user_id,r.direito_id,r.carteira,'captura',r.quantidade,0,-r.quantidade,r.job_id,
    CASE WHEN _job.tipo='texto' THEN 'Usado: texto da campanha' ELSE 'Usado: arte ' || _job.formato END
  FROM public.bolso_creditos r WHERE r.job_id=_job.id AND r.tipo='reserva'
    AND NOT EXISTS(SELECT 1 FROM public.bolso_creditos f WHERE f.job_id=r.job_id AND f.direito_id=r.direito_id AND f.tipo IN ('captura','liberacao'))
  ORDER BY r.direito_id ON CONFLICT DO NOTHING;
END $$;


CREATE OR REPLACE FUNCTION public.bolso_trabalho_pegar(_job uuid DEFAULT NULL, _lease_segundos integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.bolso_jobs; c public.bolso_config := bolso_privado.config(); camp public.bolso_campanhas; marca public.bolso_marcas; versao jsonb;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  UPDATE public.bolso_jobs SET estado = 'incerto', erro = 'O processamento parou sem resposta. Aguardando conferência.', atualizado_em = now()
  WHERE estado = 'processando' AND lease_ate < now() AND provedor IN ('openai','openrouter');
  FOR j IN UPDATE public.bolso_jobs SET estado = 'falhou', erro = 'Não deu certo depois de 3 tentativas.', atualizado_em = now()
    WHERE estado = 'processando' AND lease_ate < now() AND provedor = 'simulado' AND tentativas >= 3 RETURNING * LOOP
    PERFORM bolso_privado.liberar(j, 'Liberado: pedido não concluído');
  END LOOP;
  IF c.kill_switch THEN RETURN NULL; END IF;
  SELECT * INTO j FROM public.bolso_jobs
  WHERE (_job IS NULL OR id = _job)
    AND (estado = 'na_fila' OR (estado = 'processando' AND lease_ate < now() AND provedor = 'simulado'))
    AND (provedor = 'simulado' OR c.geracao_real)
  ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF j.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.bolso_jobs SET estado = 'processando', tentativas = tentativas + 1, lease_ate = now() + make_interval(secs => greatest(_lease_segundos, 30)),
    atualizado_em = now() WHERE id = j.id RETURNING * INTO j;
  SELECT * INTO camp FROM public.bolso_campanhas WHERE id = j.campanha_id;
  SELECT * INTO marca FROM public.bolso_marcas WHERE id = camp.marca_id;
  SELECT conteudo INTO versao FROM public.bolso_campanha_versoes WHERE campanha_id = j.campanha_id AND numero = j.versao_campanha;
  -- Só o necessário para o fornecedor: a marca e a campanha deste membro.
  RETURN jsonb_build_object('job', jsonb_build_object('id', j.id, 'user_id', j.user_id, 'campanha_id', j.campanha_id, 'tipo', j.tipo,
      'formato', j.formato, 'provedor', j.provedor, 'tentativa', j.tentativas, 'versao_campanha', j.versao_campanha),
    'marca', jsonb_build_object('nome', marca.nome, 'descricao', marca.descricao, 'publico', marca.publico, 'regiao', marca.regiao, 'tom', marca.tom, 'cores', to_jsonb(marca.cores)),
    'briefing', camp.briefing, 'versao', versao);
END $$;

CREATE OR REPLACE FUNCTION bolso_privado.conceder(_user uuid, _tipo text, _origem text, _referencia text, _politica uuid, _inicio timestamptz, _ator uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.bolso_politicas; v_carteira text := CASE WHEN _tipo = 'teste' THEN 'teste' ELSE 'real' END; novo uuid; meses integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || _user::text,7));
  SELECT * INTO p FROM public.bolso_politicas WHERE id = _politica;
  IF p.id IS NULL OR p.estado = 'arquivado' THEN RAISE EXCEPTION 'Política inexistente ou arquivada' USING ERRCODE = '22023'; END IF;
  IF v_carteira = 'real' AND (p.estado <> 'aprovado' OR p.teste) THEN RAISE EXCEPTION 'Acesso real só com política comercial aprovada' USING ERRCODE = '22023'; END IF;
  IF v_carteira = 'teste' AND NOT p.teste THEN RAISE EXCEPTION 'Crédito de teste só com política de teste' USING ERRCODE = '22023'; END IF;
  meses := CASE WHEN _tipo = 'mensal' THEN 1 ELSE (p.dados ->> 'validade_meses')::int END;
  INSERT INTO public.bolso_direitos (user_id, tipo, carteira, origem, referencia, politica_id, inicio, fim, criado_por)
  VALUES (_user, _tipo, v_carteira, _origem, _referencia, p.id, _inicio,
    ((_inicio AT TIME ZONE 'UTC') + make_interval(months => meses)) AT TIME ZONE 'UTC', _ator)
  ON CONFLICT (tipo, origem, referencia) DO NOTHING
  RETURNING id INTO novo;
  IF novo IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, descricao, ator)
  VALUES (_user, novo, v_carteira, 'concessao', (p.dados ->> 'creditos_iniciais')::int, (p.dados ->> 'creditos_iniciais')::int, 0,
    CASE WHEN v_carteira = 'teste' THEN 'TESTE: créditos de demonstração' ELSE 'Créditos do acesso ' || _tipo END, _ator);
  RETURN novo;
END $$;

CREATE OR REPLACE FUNCTION public.bolso_admin_revogar(_direito uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); u uuid;
BEGIN
  SELECT user_id INTO u FROM public.bolso_direitos WHERE id=_direito;
  IF u IS NULL THEN RAISE EXCEPTION 'Direito não encontrado' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || u::text,7));
  UPDATE public.bolso_direitos SET revogado_em = now(), motivo_revogacao = left(COALESCE(_motivo, ''), 300)
  WHERE id = _direito AND revogado_em IS NULL RETURNING user_id INTO u;
  IF u IS NULL THEN RAISE EXCEPTION 'Direito não encontrado ou já revogado' USING ERRCODE = '22023'; END IF;
  PERFORM bolso_privado.expirar(u);
  PERFORM bolso_privado.auditar('direito_revogado', _direito::text, jsonb_build_object('motivo', _motivo));
END $$;

CREATE OR REPLACE FUNCTION public.bolso_evento_pagamento(_evento jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.bolso_config := bolso_privado.config(); prov text := _evento ->> 'provedor'; eid text := _evento ->> 'evento_id';
  tipo_ text := _evento ->> 'tipo'; v_produto text := _evento ->> 'produto'; ref text := _evento ->> 'referencia';
  u uuid := NULLIF(_evento ->> 'user_id', '')::uuid; quando timestamptz := (_evento ->> 'ocorrido_em')::timestamptz;
  v_impressao text := md5(concat_ws('|', prov, eid, tipo_, v_produto, ref, u, quando)); anterior public.bolso_eventos_pagamento;
  politica uuid; d public.bolso_direitos; res text;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:pagamento:' || prov || ':' || eid,7));
  SELECT * INTO anterior FROM public.bolso_eventos_pagamento WHERE provedor = prov AND evento_id = eid;
  IF anterior.id IS NOT NULL THEN
    IF anterior.impressao <> v_impressao THEN RAISE EXCEPTION 'Evento repetido com conteúdo diferente' USING ERRCODE = '22023'; END IF;
    RETURN 'repetido';
  END IF;
  INSERT INTO public.bolso_eventos_pagamento (provedor, evento_id, tipo, produto, referencia, user_id, impressao, ocorrido_em)
  VALUES (prov, eid, tipo_, v_produto, ref, u, v_impressao, quando);
  IF NOT c.pagamentos THEN res := 'guardado: pagamentos desligados';
  ELSIF tipo_ = 'aprovado' THEN
    -- Nenhum evento legado possui preço/moeda/oferta/ordem verificados. Falha
    -- fechada mesmo se alguém mudar a flag: checkout é uma integração futura.
    res := 'guardado: aprovação exige pedido autenticado e valores verificados';
  ELSIF tipo_ IN ('reembolsado', 'chargeback') THEN
    SELECT user_id INTO u FROM public.bolso_direitos WHERE origem='pagamento' AND referencia=ref AND tipo=v_produto;
    IF u IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('bolso:' || u::text,7)); END IF;
    UPDATE public.bolso_direitos SET revogado_em = now(), motivo_revogacao = tipo_
    WHERE origem = 'pagamento' AND referencia = ref AND tipo = v_produto AND revogado_em IS NULL RETURNING * INTO d;
    IF d.id IS NOT NULL THEN PERFORM bolso_privado.expirar(d.user_id); res := 'revogado'; ELSE res := 'guardado: sem direito ativo'; END IF;
  ELSIF tipo_ = 'assinatura_cancelada' THEN
    -- Cancelar a assinatura mensal encerra só o mensal ao fim do ciclo pago. O anual não muda.
    IF v_produto <> 'mensal' THEN res := 'ignorado: só mensal tem assinatura';
    ELSE res := 'registrado: mensal termina no fim do ciclo pago'; END IF;
  END IF;
  UPDATE public.bolso_eventos_pagamento SET resultado = res WHERE provedor = prov AND evento_id = eid;
  RETURN res;
END $$;

-- Catálogo de recargas: proposta comercial, não pedido nem saldo do fornecedor.
-- Cada alteração gera nova versão; nenhuma oferta nasce publicada.
CREATE TABLE public.bolso_ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL CHECK(codigo ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  versao integer NOT NULL CHECK(versao>0),
  tipo text NOT NULL DEFAULT 'recarga' CHECK(tipo='recarga'),
  estado text NOT NULL DEFAULT 'rascunho' CHECK(estado IN ('rascunho','publicado','arquivado')),
  nome text NOT NULL CHECK(length(btrim(nome)) BETWEEN 1 AND 80),
  descricao text NOT NULL DEFAULT '' CHECK(length(descricao)<=400),
  moeda text NOT NULL DEFAULT 'BRL' CHECK(moeda='BRL'),
  preco_centavos integer NOT NULL CHECK(preco_centavos BETWEEN 1 AND 100000000),
  creditos integer NOT NULL CHECK(creditos BETWEEN 1 AND 1000000),
  validade_dias integer NOT NULL CHECK(validade_dias BETWEEN 1 AND 730),
  politica_id uuid NOT NULL REFERENCES public.bolso_politicas(id),
  provisao_ia_centavos integer NOT NULL CHECK(provisao_ia_centavos>=0 AND provisao_ia_centavos<=preco_centavos),
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_por uuid,
  aprovado_em timestamptz,
  UNIQUE(codigo,versao),
  CHECK(estado<>'publicado' OR (aprovado_por IS NOT NULL AND aprovado_em IS NOT NULL))
);
CREATE UNIQUE INDEX bolso_ofertas_publicada ON public.bolso_ofertas(codigo) WHERE estado='publicado';
ALTER TABLE public.bolso_ofertas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bolso_ofertas FROM PUBLIC,anon,authenticated;

CREATE FUNCTION bolso_privado.oferta_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Arquive a oferta; preserve o histórico' USING ERRCODE='42501'; END IF;
  IF (to_jsonb(NEW)-ARRAY['estado','aprovado_por','aprovado_em']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['estado','aprovado_por','aprovado_em']) THEN
    RAISE EXCEPTION 'Crie outra versão da oferta para alterar as condições' USING ERRCODE='42501';
  END IF;
  IF NOT ((OLD.estado='rascunho' AND NEW.estado IN ('publicado','arquivado')) OR (OLD.estado='publicado' AND NEW.estado='arquivado')) THEN
    RAISE EXCEPTION 'Transição de oferta inválida' USING ERRCODE='22023';
  END IF;
  IF NEW.estado='arquivado' AND (NEW.aprovado_por IS DISTINCT FROM OLD.aprovado_por OR NEW.aprovado_em IS DISTINCT FROM OLD.aprovado_em) THEN
    RAISE EXCEPTION 'A aprovação anterior é imutável' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bolso_ofertas_imutavel BEFORE UPDATE OR DELETE ON public.bolso_ofertas
FOR EACH ROW EXECUTE FUNCTION bolso_privado.oferta_imutavel();

CREATE FUNCTION public.bolso_admin_ofertas_listar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM bolso_privado.exigir_admin();
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.codigo,o.versao DESC) FROM public.bolso_ofertas o),'[]'::jsonb);
END $$;

CREATE FUNCTION public.bolso_admin_oferta_salvar(_dados jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=bolso_privado.exigir_admin(); codigo_ text; politica_ uuid; campo text; nova uuid; v integer;
BEGIN
  IF jsonb_typeof(_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados da oferta inválidos' USING ERRCODE='22023'; END IF;
  codigo_:=btrim(_dados->>'codigo');
  IF codigo_ IS NULL OR codigo_ !~ '^[a-z0-9][a-z0-9-]{2,63}$' THEN
    RAISE EXCEPTION 'Código: 3 a 64 letras minúsculas, números ou hífen' USING ERRCODE='22023';
  END IF;
  FOREACH campo IN ARRAY ARRAY['preco_centavos','creditos','validade_dias','provisao_ia_centavos'] LOOP
    IF jsonb_typeof(_dados->campo) IS DISTINCT FROM 'number' OR (_dados->>campo)::numeric<>floor((_dados->>campo)::numeric) THEN
      RAISE EXCEPTION 'Informe % como inteiro',campo USING ERRCODE='22023';
    END IF;
  END LOOP;
  politica_:=(_dados->>'politica_id')::uuid;
  IF politica_ IS NULL OR NOT EXISTS(SELECT 1 FROM public.bolso_politicas WHERE id=politica_ AND NOT teste AND estado<>'arquivado') THEN
    RAISE EXCEPTION 'Escolha uma política comercial válida' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:oferta:' || codigo_,7));
  SELECT COALESCE(max(versao),0)+1 INTO v FROM public.bolso_ofertas WHERE codigo=codigo_;
  INSERT INTO public.bolso_ofertas(codigo,versao,nome,descricao,preco_centavos,creditos,validade_dias,politica_id,provisao_ia_centavos,criado_por)
  VALUES(codigo_,v,btrim(_dados->>'nome'),COALESCE(btrim(_dados->>'descricao'),''),(_dados->>'preco_centavos')::integer,
    (_dados->>'creditos')::integer,(_dados->>'validade_dias')::integer,politica_,(_dados->>'provisao_ia_centavos')::integer,a)
  RETURNING id INTO nova;
  PERFORM bolso_privado.auditar('oferta_rascunho',nova::text,jsonb_build_object('codigo',codigo_,'versao',v));
  RETURN nova;
END $$;

CREATE FUNCTION public.bolso_admin_oferta_aprovar(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=bolso_privado.exigir_admin(); o public.bolso_ofertas; codigo_ text;
BEGIN
  SELECT codigo INTO codigo_ FROM public.bolso_ofertas WHERE id=_id;
  IF codigo_ IS NULL THEN RAISE EXCEPTION 'Oferta não encontrada' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:oferta:' || codigo_,7));
  SELECT * INTO o FROM public.bolso_ofertas WHERE id=_id FOR UPDATE;
  IF o.estado<>'rascunho' THEN RAISE EXCEPTION 'Só um rascunho pode ser publicado' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bolso_politicas WHERE id=o.politica_id AND estado='aprovado' AND NOT teste) THEN
    RAISE EXCEPTION 'Aprove a política comercial antes de publicar a oferta' USING ERRCODE='22023';
  END IF;
  UPDATE public.bolso_ofertas SET estado='arquivado' WHERE codigo=o.codigo AND estado='publicado';
  UPDATE public.bolso_ofertas SET estado='publicado',aprovado_por=a,aprovado_em=now() WHERE id=_id;
  PERFORM bolso_privado.auditar('oferta_publicada',_id::text,jsonb_build_object('codigo',o.codigo,'versao',o.versao));
END $$;

CREATE FUNCTION public.bolso_admin_oferta_arquivar(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=bolso_privado.exigir_admin(); codigo_ text;
BEGIN
  SELECT codigo INTO codigo_ FROM public.bolso_ofertas WHERE id=_id;
  IF codigo_ IS NULL THEN RAISE EXCEPTION 'Oferta não encontrada' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bolso:oferta:' || codigo_,7));
  UPDATE public.bolso_ofertas SET estado='arquivado' WHERE id=_id AND estado<>'arquivado';
  IF FOUND THEN PERFORM bolso_privado.auditar('oferta_arquivada',_id::text,NULL); END IF;
END $$;

CREATE FUNCTION public.bolso_ofertas_listar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=bolso_privado.exigir_membro(); acesso public.bolso_direitos;
BEGIN
  acesso:=bolso_privado.direito_ativo(u,'real');
  RETURN jsonb_build_object('pagamentos_habilitados',false,'acesso_ativo',acesso.id IS NOT NULL,
    'ofertas',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',o.id,'codigo',o.codigo,'versao',o.versao,'tipo',o.tipo,'nome',o.nome,'descricao',o.descricao,
      'preco_centavos',o.preco_centavos,'moeda',o.moeda,'creditos',o.creditos,'validade_dias',o.validade_dias,
      'tarifa_texto',(p.dados->>'tarifa_texto')::integer,'tarifa_imagem',(p.dados->>'tarifa_imagem')::integer,'formatos',p.dados->'formatos'
    ) ORDER BY o.preco_centavos,o.creditos,o.codigo)
    FROM public.bolso_ofertas o JOIN public.bolso_politicas p ON p.id=o.politica_id
    WHERE o.estado='publicado' AND p.estado='aprovado' AND NOT p.teste
      AND (acesso.id IS NULL OR o.politica_id=acesso.politica_id)), '[]'::jsonb));
END $$;

-- Nenhuma destas RPCs recebe a conta de destino ou concede saldo; a futura
-- compra autenticada precisa congelar oferta, titular, valor, moeda e provisão.
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['bolso_ofertas_listar()','bolso_admin_ofertas_listar()',
    'bolso_admin_oferta_salvar(jsonb)','bolso_admin_oferta_aprovar(uuid)','bolso_admin_oferta_arquivar(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon',f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated',f);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bolso_privado FROM PUBLIC,anon,authenticated;

COMMIT;
