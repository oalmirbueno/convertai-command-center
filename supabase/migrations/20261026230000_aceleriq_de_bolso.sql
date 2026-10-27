-- ═══════════════════════════════════════════════════════════════════════
-- Aceleriq de Bolso (26/10/2026): estúdio guiado de campanhas e criativos
-- dentro da área de membros. "Sua agência de marketing digital de bolso:
-- você cria, revisa e publica." Autoatendimento; não é agência humana, não
-- é gestão de anúncios, não garante vendas.
--
-- O QUE ESTE ARQUIVO FAZ (só acrescenta; nada da biblioteca, do CRM, das
-- licenças ou de Kiwify/Asaas muda):
--   · bolso_config: as chaves do módulo, todas DESLIGADAS: módulo visível,
--     geração real, pagamentos, modo simulado e a pausa geral (kill switch).
--     Sem limites configurados nenhum pedido passa.
--   · bolso_politicas: a política comercial versionada (créditos iniciais,
--     tarifas, formatos, validade). Nasce como rascunho; só uma aprovada pelo
--     dono libera concessão e geração real. Política de TESTE nunca vale
--     para a carteira real.
--   · bolso_direitos: o direito do membro (anual, mensal, recarga, teste),
--     separado das licenças antigas. Cancelar o mensal não mexe no anual.
--   · bolso_creditos: extrato SÓ DE INCLUSÃO (concessão, reserva, captura,
--     liberação, estorno, expiração), por direito e por carteira (real ou
--     teste). O saldo é sempre a soma; ninguém grava saldo.
--   · bolso_marcas, bolso_campanhas, bolso_campanha_versoes, bolso_jobs,
--     bolso_arquivos: o caminho contexto → oferta → campanha → texto → arte
--     → revisão → download, com versões.
--   · bolso_eventos_pagamento: contrato local de eventos financeiros
--     (idempotente, fora de ordem, reembolso, chargeback). Desligado: sem
--     a chave "pagamentos" o evento só é guardado.
--   · Bucket privado "bolso": cada membro lê só a própria pasta (URL
--     assinada curta); só o servidor grava.
--
-- Acesso: todas as tabelas com RLS e sem GRANT para anon/authenticated.
-- Tudo passa por funções SECURITY DEFINER que conferem auth.uid(). O
-- trabalhador (edge function "bolso") usa a chave de serviço.
--
-- Reverter: pausar = bolso_admin_config({"kill_switch":true}) ou desligar
-- "modulo_exposto". Remover o módulo (sem apagar histórico financeiro)
-- = revogar EXECUTE das funções bolso_*; as tabelas ficam.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE SCHEMA IF NOT EXISTS bolso_privado;
REVOKE ALL ON SCHEMA bolso_privado FROM PUBLIC, anon, authenticated;

-- ─── Configuração (uma linha) ──────────────────────────────────────────
CREATE TABLE public.bolso_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  modulo_exposto boolean NOT NULL DEFAULT false,
  geracao_real boolean NOT NULL DEFAULT false,
  pagamentos boolean NOT NULL DEFAULT false,
  modo_simulado boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  -- {"paralelo_por_usuario":n,"pedidos_por_dia_usuario":n,"teto_global_dia":n}; null bloqueia.
  limites jsonb CHECK (limites IS NULL OR jsonb_typeof(limites) = 'object'),
  -- Destino comercial autorizado para "Conhecer serviços da agência"; null = desabilitado.
  destino_agencia text CHECK (destino_agencia IS NULL OR destino_agencia ~ '^https://[^/@[:space:]]+(/|$)'),
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bolso_config (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ─── Política comercial versionada ─────────────────────────────────────
CREATE TABLE public.bolso_politicas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  versao integer NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'aprovado', 'arquivado')),
  teste boolean NOT NULL DEFAULT false,
  -- {"creditos_iniciais":n,"tarifa_texto":n,"tarifa_imagem":n,"validade_meses":n,"formatos":[...]}
  dados jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  nota text NOT NULL DEFAULT '' CHECK (length(nota) <= 2000),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_por uuid,
  aprovado_em timestamptz
);

-- ─── Direitos ──────────────────────────────────────────────────────────
CREATE TABLE public.bolso_direitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  tipo text NOT NULL CHECK (tipo IN ('anual', 'mensal', 'recarga', 'teste')),
  carteira text NOT NULL CHECK (carteira IN ('real', 'teste')),
  origem text NOT NULL CHECK (origem IN ('validacao_manual', 'pagamento', 'teste')),
  referencia text NOT NULL CHECK (length(referencia) BETWEEN 1 AND 200),
  politica_id uuid NOT NULL REFERENCES public.bolso_politicas(id),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  revogado_em timestamptz,
  motivo_revogacao text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  CHECK ((tipo = 'teste') = (carteira = 'teste')),
  UNIQUE (tipo, origem, referencia)
);
CREATE INDEX bolso_direitos_titular ON public.bolso_direitos (user_id, carteira, fim);

-- ─── Extrato de créditos (só inclusão) ─────────────────────────────────
CREATE TABLE public.bolso_creditos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  direito_id uuid NOT NULL REFERENCES public.bolso_direitos(id),
  carteira text NOT NULL CHECK (carteira IN ('real', 'teste')),
  tipo text NOT NULL CHECK (tipo IN ('concessao', 'reserva', 'captura', 'liberacao', 'estorno', 'expiracao')),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  -- Efeito no disponível e no reservado (derivados do tipo).
  delta_disponivel integer NOT NULL,
  delta_reservado integer NOT NULL,
  job_id uuid,
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 300),
  ator uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (tipo = 'concessao' AND delta_disponivel = quantidade AND delta_reservado = 0)
    OR (tipo = 'reserva' AND delta_disponivel = -quantidade AND delta_reservado = quantidade)
    OR (tipo = 'captura' AND delta_disponivel = 0 AND delta_reservado = -quantidade)
    OR (tipo = 'liberacao' AND delta_disponivel = quantidade AND delta_reservado = -quantidade)
    OR (tipo IN ('estorno', 'expiracao') AND delta_disponivel = -quantidade AND delta_reservado = 0)
  ),
  CHECK ((tipo IN ('reserva', 'captura', 'liberacao')) = (job_id IS NOT NULL))
);
-- Um job reserva, captura e libera no máximo uma vez cada.
CREATE UNIQUE INDEX bolso_creditos_uma_vez_por_job ON public.bolso_creditos (job_id, tipo) WHERE job_id IS NOT NULL;
-- Captura e liberação são excludentes no mesmo job.
CREATE UNIQUE INDEX bolso_creditos_fecha_uma_vez ON public.bolso_creditos (job_id) WHERE tipo IN ('captura', 'liberacao');
-- Concessão e expiração uma vez por direito.
CREATE UNIQUE INDEX bolso_creditos_concessao_unica ON public.bolso_creditos (direito_id) WHERE tipo = 'concessao';
CREATE UNIQUE INDEX bolso_creditos_expiracao_unica ON public.bolso_creditos (direito_id) WHERE tipo = 'expiracao';
CREATE INDEX bolso_creditos_titular ON public.bolso_creditos (user_id, carteira, criado_em DESC);

CREATE FUNCTION bolso_privado.extrato_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'O extrato de créditos não muda: registre um novo lançamento' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER bolso_creditos_imutavel BEFORE UPDATE OR DELETE ON public.bolso_creditos
FOR EACH ROW EXECUTE FUNCTION bolso_privado.extrato_imutavel();

-- ─── Marca, campanha, versões ──────────────────────────────────────────
CREATE TABLE public.bolso_marcas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 1500),
  publico text NOT NULL DEFAULT '' CHECK (length(publico) <= 600),
  regiao text NOT NULL DEFAULT '' CHECK (length(regiao) <= 200),
  tom text NOT NULL DEFAULT '' CHECK (length(tom) <= 300),
  cores text[] NOT NULL DEFAULT '{}' CHECK (cardinality(cores) <= 6),
  direitos_confirmados boolean NOT NULL DEFAULT false,
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bolso_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  marca_id uuid NOT NULL REFERENCES public.bolso_marcas(id),
  titulo text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  -- {"tipo":"venda|agendamento|orcamento","produto":"","objetivo":"","canal":"","condicoes":"","cta":""}
  briefing jsonb NOT NULL CHECK (jsonb_typeof(briefing) = 'object'),
  versao_escolhida integer,
  arquivada boolean NOT NULL DEFAULT false,
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX bolso_campanhas_titular ON public.bolso_campanhas (user_id, atualizado_em DESC);

CREATE TABLE public.bolso_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  campanha_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'imagem')),
  formato text CHECK (formato IS NULL OR formato IN ('feed_1x1', 'feed_4x5', 'stories_9x16')),
  versao_campanha integer,
  estado text NOT NULL CHECK (estado IN ('na_fila', 'processando', 'concluido', 'falhou', 'cancelado', 'incerto')),
  provedor text NOT NULL CHECK (provedor IN ('simulado', 'openai')),
  carteira text NOT NULL CHECK (carteira IN ('real', 'teste')),
  direito_id uuid NOT NULL REFERENCES public.bolso_direitos(id),
  politica_id uuid NOT NULL REFERENCES public.bolso_politicas(id),
  tarifa integer NOT NULL CHECK (tarifa >= 0),
  chave text NOT NULL CHECK (length(chave) BETWEEN 8 AND 120),
  impressao text NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  lease_ate timestamptz,
  erro text,
  resultado jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  FOREIGN KEY (campanha_id, user_id) REFERENCES public.bolso_campanhas(id, user_id),
  UNIQUE (user_id, chave),
  CHECK ((tipo = 'imagem') = (formato IS NOT NULL))
);
CREATE INDEX bolso_jobs_fila ON public.bolso_jobs (estado, criado_em) WHERE estado IN ('na_fila', 'processando');
CREATE INDEX bolso_jobs_titular ON public.bolso_jobs (user_id, criado_em DESC);

CREATE TABLE public.bolso_campanha_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL,
  user_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero > 0),
  origem text NOT NULL CHECK (origem IN ('manual', 'gerada', 'simulada')),
  -- {"mensagem":"","texto":"","cta":"","aplicacao":"","direcao_visual":""}
  conteudo jsonb NOT NULL CHECK (jsonb_typeof(conteudo) = 'object'),
  job_id uuid REFERENCES public.bolso_jobs(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campanha_id, user_id) REFERENCES public.bolso_campanhas(id, user_id),
  UNIQUE (campanha_id, numero)
);

CREATE TABLE public.bolso_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  campanha_id uuid NOT NULL,
  job_id uuid NOT NULL UNIQUE REFERENCES public.bolso_jobs(id),
  versao_campanha integer NOT NULL,
  formato text NOT NULL,
  caminho text NOT NULL UNIQUE CHECK (caminho ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|webp|jpg)$'),
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/webp', 'image/jpeg')),
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 10485760),
  simulado boolean NOT NULL,
  escolhido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campanha_id, user_id) REFERENCES public.bolso_campanhas(id, user_id)
);

-- Custo do fornecedor: registro separado do crédito comercial.
CREATE TABLE public.bolso_custos_fornecedor (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.bolso_jobs(id),
  provedor text NOT NULL,
  modelo text,
  custo_usd numeric(12, 6) NOT NULL CHECK (custo_usd >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id)
);

-- Eventos financeiros (contrato local; provedor real desligado).
CREATE TABLE public.bolso_eventos_pagamento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provedor text NOT NULL CHECK (provedor IN ('kiwify', 'asaas', 'teste')),
  evento_id text NOT NULL CHECK (length(evento_id) BETWEEN 1 AND 200),
  tipo text NOT NULL CHECK (tipo IN ('aprovado', 'reembolsado', 'chargeback', 'assinatura_cancelada')),
  produto text NOT NULL CHECK (produto IN ('anual', 'mensal', 'recarga')),
  referencia text NOT NULL CHECK (length(referencia) BETWEEN 1 AND 200),
  user_id uuid REFERENCES auth.users(id),
  impressao text NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  resultado text,
  UNIQUE (provedor, evento_id)
);

CREATE TABLE public.bolso_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ator uuid,
  acao text NOT NULL,
  alvo text,
  dados jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bolso_config','bolso_politicas','bolso_direitos','bolso_creditos','bolso_marcas','bolso_campanhas',
    'bolso_jobs','bolso_campanha_versoes','bolso_arquivos','bolso_custos_fornecedor','bolso_eventos_pagamento','bolso_auditoria'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- ─── Storage privado ───────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bolso', 'bolso', false, 10485760, ARRAY['image/png', 'image/webp', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'bolso' AND public) THEN
    RAISE EXCEPTION 'O bucket bolso existe e está público. Revisar antes de seguir.';
  END IF;
END $$;
-- O membro lê só a própria pasta (primeiro segmento = user_id).
CREATE POLICY bolso_storage_le ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bolso' AND (storage.foldername(name))[1] = auth.uid()::text);
-- Barreira: nenhuma política antiga e permissiva abre o bucket. Só o servidor (chave de serviço) grava.
CREATE POLICY bolso_storage_barreira ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'bolso' OR (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id <> 'bolso');

-- ─── Auxiliares ────────────────────────────────────────────────────────
CREATE FUNCTION bolso_privado.config() RETURNS public.bolso_config
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.bolso_config WHERE id
$$;

CREATE FUNCTION bolso_privado.exigir_membro() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.membros_usuario_confirmado() THEN
    RAISE EXCEPTION 'Entre e confirme seu cadastro' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END $$;

CREATE FUNCTION bolso_privado.exigir_admin() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.membros_admin() THEN
    RAISE EXCEPTION 'Somente administração' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END $$;

CREATE FUNCTION bolso_privado.exigir_servico() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Somente o servidor' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE FUNCTION bolso_privado.auditar(_acao text, _alvo text, _dados jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.bolso_auditoria (ator, acao, alvo, dados) VALUES (auth.uid(), _acao, _alvo, _dados)
$$;

-- A política tem todos os campos e só formatos suportados. Erro claro quando falta algo.
CREATE FUNCTION bolso_privado.validar_politica(_d jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['creditos_iniciais', 'tarifa_texto', 'tarifa_imagem', 'validade_meses'] LOOP
    IF jsonb_typeof(_d -> f) IS DISTINCT FROM 'number' OR (_d ->> f)::numeric <> floor((_d ->> f)::numeric) OR (_d ->> f)::numeric < 0 THEN
      RAISE EXCEPTION 'Política sem % (inteiro, zero ou mais)', f USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (_d ->> 'creditos_iniciais')::int < 1 OR (_d ->> 'tarifa_imagem')::int < 1 OR (_d ->> 'validade_meses')::int NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'Créditos iniciais e tarifa de imagem acima de zero; validade de 1 a 24 meses' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_d -> 'formatos') IS DISTINCT FROM 'array' OR jsonb_array_length(_d -> 'formatos') = 0
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(_d -> 'formatos') x WHERE x NOT IN ('feed_1x1', 'feed_4x5', 'stories_9x16')) THEN
    RAISE EXCEPTION 'Formatos suportados: feed_1x1, feed_4x5, stories_9x16' USING ERRCODE = '22023';
  END IF;
END $$;

-- Expira o que sobrou de direitos vencidos ou revogados (uma vez por direito).
CREATE FUNCTION bolso_privado.expirar(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d record; sobra integer;
BEGIN
  FOR d IN SELECT id, carteira, revogado_em FROM public.bolso_direitos
    WHERE user_id = _user AND (fim <= now() OR revogado_em IS NOT NULL) LOOP
    SELECT COALESCE(sum(delta_disponivel), 0) INTO sobra FROM public.bolso_creditos WHERE direito_id = d.id;
    IF sobra > 0 THEN
      INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, descricao)
      VALUES (_user, d.id, d.carteira, CASE WHEN d.revogado_em IS NOT NULL THEN 'estorno' ELSE 'expiracao' END, sobra, -sobra, 0,
        CASE WHEN d.revogado_em IS NOT NULL THEN 'Créditos estornados com o acesso' ELSE 'Créditos vencidos com o acesso' END)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION bolso_privado.saldo(_user uuid, _carteira text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'disponivel', COALESCE((SELECT sum(c.delta_disponivel) FROM public.bolso_creditos c JOIN public.bolso_direitos d ON d.id = c.direito_id
      WHERE c.user_id = _user AND c.carteira = _carteira AND d.fim > now() AND d.revogado_em IS NULL), 0),
    'reservado', COALESCE((SELECT sum(delta_reservado) FROM public.bolso_creditos WHERE user_id = _user AND carteira = _carteira), 0))
$$;

CREATE FUNCTION bolso_privado.direito_ativo(_user uuid, _carteira text) RETURNS public.bolso_direitos
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.bolso_direitos
  WHERE user_id = _user AND carteira = _carteira AND revogado_em IS NULL AND inicio <= now() AND fim > now()
  ORDER BY fim DESC LIMIT 1
$$;

-- Como este membro pode gerar agora. Devolve {modo, carteira, motivo}.
CREATE FUNCTION bolso_privado.modo_do_membro(_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.bolso_config := bolso_privado.config(); admin boolean := public.has_role(_user, 'admin'::public.app_role);
  real_ok boolean; teste_ok boolean;
BEGIN
  IF c.kill_switch THEN RETURN jsonb_build_object('modo', 'pausado', 'motivo', 'O estúdio está pausado pela administração. Suas campanhas e arquivos continuam disponíveis.'); END IF;
  -- Fechado ao público: só admin e quem recebeu crédito de teste (com o modo demonstração ligado) entram.
  IF NOT c.modulo_exposto AND NOT admin
    AND NOT (c.modo_simulado AND (bolso_privado.direito_ativo(_user, 'teste')).id IS NOT NULL) THEN
    RETURN jsonb_build_object('modo', 'fechado', 'motivo', 'O estúdio ainda não está disponível.');
  END IF;
  real_ok := c.geracao_real AND (bolso_privado.direito_ativo(_user, 'real')).id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.bolso_politicas WHERE estado = 'aprovado' AND NOT teste);
  IF real_ok THEN RETURN jsonb_build_object('modo', 'real', 'carteira', 'real'); END IF;
  teste_ok := c.modo_simulado AND (admin OR (bolso_privado.direito_ativo(_user, 'teste')).id IS NOT NULL);
  IF teste_ok THEN RETURN jsonb_build_object('modo', 'simulado', 'carteira', 'teste'); END IF;
  IF (bolso_privado.direito_ativo(_user, 'real')).id IS NULL AND (bolso_privado.direito_ativo(_user, 'teste')).id IS NULL THEN
    RETURN jsonb_build_object('modo', 'sem_acesso', 'motivo', 'Seu acesso ao estúdio não está ativo. Campanhas e arquivos já criados continuam aqui para consulta.');
  END IF;
  RETURN jsonb_build_object('modo', 'indisponivel', 'motivo', 'A criação com IA ainda não está liberada. Você pode montar e editar a campanha à mão.');
END $$;

-- ─── Leitura do membro ─────────────────────────────────────────────────
CREATE FUNCTION public.bolso_estado() RETURNS jsonb
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
  v_carteira := COALESCE(m ->> 'carteira', CASE WHEN (bolso_privado.direito_ativo(u, 'real')).id IS NOT NULL THEN 'real' ELSE 'teste' END);
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

CREATE FUNCTION public.bolso_extrato(_limite integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro();
BEGIN
  PERFORM bolso_privado.expirar(u);
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.criado_em DESC) FROM (
    SELECT c.id, c.carteira, c.tipo, c.quantidade, c.delta_disponivel, c.delta_reservado, c.descricao, c.criado_em, c.job_id
    FROM public.bolso_creditos c WHERE c.user_id = u ORDER BY c.criado_em DESC, c.id DESC LIMIT least(greatest(_limite, 1), 200)) x), '[]'::jsonb);
END $$;

CREATE FUNCTION public.bolso_marca_ler() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(m) FROM public.bolso_marcas m WHERE m.user_id = bolso_privado.exigir_membro()
$$;

CREATE FUNCTION public.bolso_marca_salvar(_dados jsonb, _versao integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); atual public.bolso_marcas; cores text[];
BEGIN
  IF jsonb_typeof(_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  IF COALESCE((_dados ->> 'direitos_confirmados')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirme que você tem direito de usar o nome, a logo e as imagens da marca' USING ERRCODE = '22023';
  END IF;
  cores := ARRAY(SELECT x FROM jsonb_array_elements_text(COALESCE(_dados -> 'cores', '[]'::jsonb)) x WHERE x ~ '^#[0-9a-fA-F]{6}$' LIMIT 6);
  SELECT * INTO atual FROM public.bolso_marcas WHERE user_id = u FOR UPDATE;
  IF atual.id IS NOT NULL AND _versao IS DISTINCT FROM atual.versao THEN
    RAISE EXCEPTION 'A marca mudou em outra aba. Recarregue para continuar.' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.bolso_marcas (user_id, nome, descricao, publico, regiao, tom, cores, direitos_confirmados)
  VALUES (u, btrim(_dados ->> 'nome'), COALESCE(btrim(_dados ->> 'descricao'), ''), COALESCE(btrim(_dados ->> 'publico'), ''),
    COALESCE(btrim(_dados ->> 'regiao'), ''), COALESCE(btrim(_dados ->> 'tom'), ''), cores, true)
  ON CONFLICT (user_id) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, publico = EXCLUDED.publico,
    regiao = EXCLUDED.regiao, tom = EXCLUDED.tom, cores = EXCLUDED.cores, direitos_confirmados = true,
    versao = public.bolso_marcas.versao + 1, atualizado_em = now();
  RETURN (SELECT to_jsonb(m) FROM public.bolso_marcas m WHERE m.user_id = u);
END $$;

-- Briefing: só o que o membro informou. Nada é inventado para completar.
CREATE FUNCTION bolso_privado.limpar_briefing(_b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE r jsonb := '{}'::jsonb; f text; v text;
BEGIN
  IF jsonb_typeof(_b) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Briefing inválido' USING ERRCODE = '22023'; END IF;
  IF COALESCE(_b ->> 'tipo', '') NOT IN ('venda', 'agendamento', 'orcamento') THEN
    RAISE EXCEPTION 'Escolha o objetivo: venda, agendamento ou orçamento' USING ERRCODE = '22023';
  END IF;
  r := jsonb_build_object('tipo', _b ->> 'tipo');
  FOREACH f IN ARRAY ARRAY['produto', 'objetivo', 'canal', 'condicoes', 'cta', 'publico', 'diferencial'] LOOP
    v := btrim(COALESCE(_b ->> f, ''));
    IF length(v) > 1500 THEN RAISE EXCEPTION 'O campo % passou de 1500 caracteres', f USING ERRCODE = '22023'; END IF;
    r := r || jsonb_build_object(f, v);
  END LOOP;
  IF r ->> 'produto' = '' THEN RAISE EXCEPTION 'Diga qual produto ou serviço a campanha divulga' USING ERRCODE = '22023'; END IF;
  RETURN r;
END $$;

CREATE FUNCTION public.bolso_campanha_salvar(_dados jsonb, _versao integer DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); marca uuid; id_ uuid := NULLIF(_dados ->> 'id', '')::uuid; atual public.bolso_campanhas;
  v_briefing jsonb := bolso_privado.limpar_briefing(_dados -> 'briefing'); v_titulo text := btrim(COALESCE(_dados ->> 'titulo', ''));
BEGIN
  SELECT id INTO marca FROM public.bolso_marcas WHERE user_id = u;
  IF marca IS NULL THEN RAISE EXCEPTION 'Cadastre a marca antes da campanha' USING ERRCODE = '22023'; END IF;
  IF v_titulo = '' THEN v_titulo := left(v_briefing ->> 'produto', 160); END IF;
  IF id_ IS NULL THEN
    INSERT INTO public.bolso_campanhas (user_id, marca_id, titulo, briefing) VALUES (u, marca, v_titulo, v_briefing) RETURNING id INTO id_;
    RETURN id_;
  END IF;
  SELECT * INTO atual FROM public.bolso_campanhas WHERE id = id_ AND user_id = u FOR UPDATE;
  IF atual.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE = '42501'; END IF;
  IF _versao IS DISTINCT FROM atual.versao THEN RAISE EXCEPTION 'A campanha mudou em outra aba. Recarregue para continuar.' USING ERRCODE = '40001'; END IF;
  UPDATE public.bolso_campanhas SET titulo = left(v_titulo, 160), briefing = v_briefing, versao = versao + 1, atualizado_em = now()
  WHERE id = id_;
  RETURN id_;
END $$;

CREATE FUNCTION public.bolso_campanhas_listar() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'titulo', c.titulo, 'tipo', c.briefing ->> 'tipo',
    'versao_escolhida', c.versao_escolhida, 'atualizado_em', c.atualizado_em,
    'versoes', (SELECT count(*) FROM public.bolso_campanha_versoes v WHERE v.campanha_id = c.id),
    'artes', (SELECT count(*) FROM public.bolso_arquivos a WHERE a.campanha_id = c.id),
    'em_andamento', (SELECT count(*) FROM public.bolso_jobs j WHERE j.campanha_id = c.id AND j.estado IN ('na_fila', 'processando')))
    ORDER BY c.atualizado_em DESC), '[]'::jsonb)
  FROM public.bolso_campanhas c WHERE c.user_id = bolso_privado.exigir_membro() AND NOT c.arquivada
$$;

CREATE FUNCTION public.bolso_campanha_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); c public.bolso_campanhas;
BEGIN
  SELECT * INTO c FROM public.bolso_campanhas WHERE id = _id AND user_id = u;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE = '42501'; END IF;
  RETURN to_jsonb(c) || jsonb_build_object(
    'versoes', COALESCE((SELECT jsonb_agg(jsonb_build_object('numero', v.numero, 'origem', v.origem, 'conteudo', v.conteudo, 'criado_em', v.criado_em) ORDER BY v.numero DESC)
      FROM public.bolso_campanha_versoes v WHERE v.campanha_id = c.id), '[]'::jsonb),
    'jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'tipo', j.tipo, 'formato', j.formato, 'estado', j.estado, 'provedor', j.provedor,
      'tarifa', j.tarifa, 'carteira', j.carteira, 'versao_campanha', j.versao_campanha, 'erro', j.erro, 'criado_em', j.criado_em) ORDER BY j.criado_em DESC)
      FROM public.bolso_jobs j WHERE j.campanha_id = c.id), '[]'::jsonb),
    'artes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'caminho', a.caminho, 'formato', a.formato, 'mime', a.mime, 'bytes', a.bytes,
      'versao_campanha', a.versao_campanha, 'simulado', a.simulado, 'escolhido', a.escolhido, 'criado_em', a.criado_em) ORDER BY a.criado_em DESC)
      FROM public.bolso_arquivos a WHERE a.campanha_id = c.id), '[]'::jsonb));
END $$;

-- Edição manual: nova versão, sem crédito.
CREATE FUNCTION public.bolso_versao_salvar(_campanha uuid, _conteudo jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); n integer; limpo jsonb := '{}'::jsonb; f text; v text;
BEGIN
  PERFORM 1 FROM public.bolso_campanhas WHERE id = _campanha AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campanha não encontrada' USING ERRCODE = '42501'; END IF;
  FOREACH f IN ARRAY ARRAY['mensagem', 'texto', 'cta', 'aplicacao', 'direcao_visual'] LOOP
    v := btrim(COALESCE(_conteudo ->> f, ''));
    IF length(v) > 4000 THEN RAISE EXCEPTION 'O campo % passou de 4000 caracteres', f USING ERRCODE = '22023'; END IF;
    limpo := limpo || jsonb_build_object(f, v);
  END LOOP;
  IF limpo ->> 'texto' = '' THEN RAISE EXCEPTION 'Escreva o texto da campanha' USING ERRCODE = '22023'; END IF;
  SELECT COALESCE(max(numero), 0) + 1 INTO n FROM public.bolso_campanha_versoes WHERE campanha_id = _campanha;
  INSERT INTO public.bolso_campanha_versoes (campanha_id, user_id, numero, origem, conteudo) VALUES (_campanha, u, n, 'manual', limpo);
  UPDATE public.bolso_campanhas SET versao_escolhida = n, atualizado_em = now() WHERE id = _campanha;
  RETURN n;
END $$;

CREATE FUNCTION public.bolso_versao_escolher(_campanha uuid, _numero integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bolso_campanha_versoes WHERE campanha_id = _campanha AND user_id = u AND numero = _numero) THEN
    RAISE EXCEPTION 'Versão não encontrada' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bolso_campanhas SET versao_escolhida = _numero, atualizado_em = now() WHERE id = _campanha AND user_id = u;
END $$;

CREATE FUNCTION public.bolso_arte_escolher(_arquivo uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); camp uuid;
BEGIN
  SELECT campanha_id INTO camp FROM public.bolso_arquivos WHERE id = _arquivo AND user_id = u;
  IF camp IS NULL THEN RAISE EXCEPTION 'Arte não encontrada' USING ERRCODE = '42501'; END IF;
  UPDATE public.bolso_arquivos SET escolhido = (id = _arquivo) WHERE campanha_id = camp AND user_id = u;
END $$;

-- ─── Pedido com reserva de créditos ────────────────────────────────────
-- Reserva antes de enfileirar, com trava por membro: dois pedidos ao mesmo
-- tempo nunca gastam o mesmo saldo. A mesma chave com o mesmo pedido devolve
-- o job existente; com pedido diferente é recusada.
CREATE FUNCTION public.bolso_pedir(_campanha uuid, _tipo text, _formato text, _chave text, _tarifa_vista integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); c public.bolso_config := bolso_privado.config(); m jsonb; v_carteira text;
  d public.bolso_direitos; p public.bolso_politicas; v_tarifa integer; v_impressao text; existente public.bolso_jobs; v_versao integer;
  disp integer; novo uuid; lim jsonb; n integer;
BEGIN
  IF _tipo NOT IN ('texto', 'imagem') THEN RAISE EXCEPTION 'Tipo de pedido inválido' USING ERRCODE = '22023'; END IF;
  IF (_tipo = 'imagem') <> (_formato IS NOT NULL) THEN RAISE EXCEPTION 'Formato só vale para arte' USING ERRCODE = '22023'; END IF;
  IF _chave IS NULL OR length(_chave) NOT BETWEEN 8 AND 120 THEN RAISE EXCEPTION 'Chave do pedido inválida' USING ERRCODE = '22023'; END IF;
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

  -- Direito com saldo: o que vence primeiro.
  SELECT dd.* INTO d FROM public.bolso_direitos dd
  WHERE dd.user_id = u AND dd.carteira = v_carteira AND dd.revogado_em IS NULL AND dd.inicio <= now() AND dd.fim > now()
  ORDER BY dd.fim ASC LIMIT 1;
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
  SELECT COALESCE(sum(delta_disponivel), 0) INTO disp FROM public.bolso_creditos WHERE direito_id = d.id;
  IF disp < v_tarifa THEN RAISE EXCEPTION 'Saldo insuficiente: este pedido usa % crédito(s) e você tem %.', v_tarifa, disp USING ERRCODE = '53400'; END IF;

  INSERT INTO public.bolso_jobs (user_id, campanha_id, tipo, formato, versao_campanha, estado, provedor, carteira, direito_id, politica_id, tarifa, chave, impressao)
  VALUES (u, _campanha, _tipo, _formato, CASE WHEN _tipo = 'imagem' THEN v_versao END, 'na_fila',
    CASE WHEN m ->> 'modo' = 'real' THEN 'openai' ELSE 'simulado' END, v_carteira, d.id, p.id, v_tarifa, _chave, v_impressao)
  RETURNING id INTO novo;
  IF v_tarifa > 0 THEN
    INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, job_id, descricao, ator)
    VALUES (u, d.id, v_carteira, 'reserva', v_tarifa, -v_tarifa, v_tarifa, novo,
      CASE WHEN _tipo = 'texto' THEN 'Reserva: texto da campanha' ELSE 'Reserva: arte ' || _formato END, u);
  END IF;
  RETURN jsonb_build_object('job_id', novo, 'estado', 'na_fila', 'repetido', false, 'tarifa', v_tarifa, 'provedor', CASE WHEN m ->> 'modo' = 'real' THEN 'openai' ELSE 'simulado' END);
END $$;

-- Libera a reserva uma vez (falha definitiva, cancelamento).
CREATE FUNCTION bolso_privado.liberar(_job public.bolso_jobs, _descricao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _job.tarifa > 0 THEN
    INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, job_id, descricao)
    VALUES (_job.user_id, _job.direito_id, _job.carteira, 'liberacao', _job.tarifa, _job.tarifa, -_job.tarifa, _job.id, _descricao)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE FUNCTION bolso_privado.capturar(_job public.bolso_jobs) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _job.tarifa > 0 THEN
    INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, job_id, descricao)
    VALUES (_job.user_id, _job.direito_id, _job.carteira, 'captura', _job.tarifa, 0, -_job.tarifa, _job.id,
      CASE WHEN _job.tipo = 'texto' THEN 'Usado: texto da campanha' ELSE 'Usado: arte ' || _job.formato END)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE FUNCTION public.bolso_cancelar(_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := bolso_privado.exigir_membro(); j public.bolso_jobs;
BEGIN
  SELECT * INTO j FROM public.bolso_jobs WHERE id = _job AND user_id = u FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado' USING ERRCODE = '42501'; END IF;
  IF j.estado <> 'na_fila' THEN RAISE EXCEPTION 'Este pedido já começou e não pode ser cancelado' USING ERRCODE = '22023'; END IF;
  UPDATE public.bolso_jobs SET estado = 'cancelado', atualizado_em = now() WHERE id = j.id;
  PERFORM bolso_privado.liberar(j, 'Liberado: pedido cancelado');
END $$;

-- ─── Trabalhador (só a chave de serviço) ───────────────────────────────
-- Pega um job da fila (ou um preso com o lease vencido). Job real com lease
-- vencido vira "incerto": o fornecedor pode ter respondido, então não repete
-- sozinho; a administração reconcilia.
CREATE FUNCTION public.bolso_trabalho_pegar(_job uuid DEFAULT NULL, _lease_segundos integer DEFAULT 120) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.bolso_jobs; c public.bolso_config := bolso_privado.config(); camp public.bolso_campanhas; marca public.bolso_marcas; versao jsonb;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  UPDATE public.bolso_jobs SET estado = 'incerto', erro = 'O processamento parou sem resposta. Aguardando conferência.', atualizado_em = now()
  WHERE estado = 'processando' AND lease_ate < now() AND provedor = 'openai';
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

CREATE FUNCTION public.bolso_trabalho_concluir(_job uuid, _tentativa integer, _resultado jsonb, _arquivo jsonb DEFAULT NULL, _custo jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.bolso_jobs; n integer; limpo jsonb := '{}'::jsonb; f text; v text;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  SELECT * INTO j FROM public.bolso_jobs WHERE id = _job FOR UPDATE;
  -- Resposta atrasada (outra tentativa, cancelado, já fechado) não muda nada.
  IF j.id IS NULL OR j.estado <> 'processando' OR j.tentativas <> _tentativa THEN
    RETURN jsonb_build_object('aceito', false, 'estado', j.estado);
  END IF;
  IF j.tipo = 'texto' THEN
    FOREACH f IN ARRAY ARRAY['mensagem', 'texto', 'cta', 'aplicacao', 'direcao_visual'] LOOP
      v := btrim(COALESCE(_resultado ->> f, ''));
      IF length(v) > 4000 THEN v := left(v, 4000); END IF;
      limpo := limpo || jsonb_build_object(f, v);
    END LOOP;
    IF limpo ->> 'texto' = '' OR limpo ->> 'mensagem' = '' THEN RAISE EXCEPTION 'Resultado sem texto ou mensagem' USING ERRCODE = '22023'; END IF;
    SELECT COALESCE(max(numero), 0) + 1 INTO n FROM public.bolso_campanha_versoes WHERE campanha_id = j.campanha_id;
    INSERT INTO public.bolso_campanha_versoes (campanha_id, user_id, numero, origem, conteudo, job_id)
    VALUES (j.campanha_id, j.user_id, n, CASE WHEN j.provedor = 'simulado' THEN 'simulada' ELSE 'gerada' END, limpo, j.id);
    UPDATE public.bolso_campanhas SET versao_escolhida = COALESCE(versao_escolhida, n), atualizado_em = now() WHERE id = j.campanha_id;
  ELSE
    IF _arquivo IS NULL OR (_arquivo ->> 'caminho') IS NULL OR split_part(_arquivo ->> 'caminho', '/', 1) <> j.user_id::text
      OR split_part(_arquivo ->> 'caminho', '/', 2) <> j.campanha_id::text THEN
      RAISE EXCEPTION 'Arquivo fora da pasta do membro' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.bolso_arquivos (user_id, campanha_id, job_id, versao_campanha, formato, caminho, mime, bytes, simulado)
    VALUES (j.user_id, j.campanha_id, j.id, j.versao_campanha, j.formato, _arquivo ->> 'caminho', _arquivo ->> 'mime', (_arquivo ->> 'bytes')::int, j.provedor = 'simulado');
  END IF;
  UPDATE public.bolso_jobs SET estado = 'concluido', resultado = CASE WHEN j.tipo = 'texto' THEN limpo ELSE _arquivo END,
    lease_ate = NULL, erro = NULL, concluido_em = now(), atualizado_em = now() WHERE id = j.id;
  PERFORM bolso_privado.capturar(j);
  IF _custo IS NOT NULL AND (_custo ->> 'custo_usd') IS NOT NULL THEN
    INSERT INTO public.bolso_custos_fornecedor (job_id, provedor, modelo, custo_usd) VALUES (j.id, j.provedor, _custo ->> 'modelo', (_custo ->> 'custo_usd')::numeric)
    ON CONFLICT (job_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('aceito', true, 'estado', 'concluido');
END $$;

CREATE FUNCTION public.bolso_trabalho_falhar(_job uuid, _tentativa integer, _erro text, _definitiva boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.bolso_jobs; novo text;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  SELECT * INTO j FROM public.bolso_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL OR j.estado <> 'processando' OR j.tentativas <> _tentativa THEN RETURN jsonb_build_object('aceito', false, 'estado', j.estado); END IF;
  novo := CASE WHEN _definitiva OR j.tentativas >= 3 THEN 'falhou' ELSE 'na_fila' END;
  UPDATE public.bolso_jobs SET estado = novo, erro = left(COALESCE(_erro, 'Falha sem detalhe'), 500), lease_ate = NULL, atualizado_em = now() WHERE id = j.id;
  IF novo = 'falhou' THEN PERFORM bolso_privado.liberar(j, 'Liberado: pedido não concluído'); END IF;
  RETURN jsonb_build_object('aceito', true, 'estado', novo);
END $$;

-- ─── Administração ─────────────────────────────────────────────────────
CREATE FUNCTION public.bolso_admin_visao() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM bolso_privado.exigir_admin();
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(c) FROM public.bolso_config c WHERE id),
    'politicas', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.versao DESC) FROM public.bolso_politicas p), '[]'::jsonb),
    'incertos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'tipo', j.tipo, 'provedor', j.provedor, 'carteira', j.carteira, 'erro', j.erro, 'atualizado_em', j.atualizado_em))
      FROM public.bolso_jobs j WHERE j.estado = 'incerto'), '[]'::jsonb),
    'fila', (SELECT count(*) FROM public.bolso_jobs WHERE estado IN ('na_fila', 'processando')),
    'direitos', (SELECT count(*) FROM public.bolso_direitos WHERE revogado_em IS NULL AND fim > now()),
    'eventos_pendentes', (SELECT count(*) FROM public.bolso_eventos_pagamento WHERE resultado IS NULL OR resultado LIKE 'guardado%'));
END $$;

CREATE FUNCTION public.bolso_admin_config(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); f text;
BEGIN
  IF jsonb_typeof(_dados) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  FOREACH f IN ARRAY ARRAY['modulo_exposto', 'geracao_real', 'pagamentos', 'modo_simulado', 'kill_switch'] LOOP
    IF _dados ? f AND jsonb_typeof(_dados -> f) <> 'boolean' THEN RAISE EXCEPTION 'A chave % precisa ser verdadeiro ou falso', f USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF COALESCE((_dados ->> 'geracao_real')::boolean, false) AND NOT EXISTS (SELECT 1 FROM public.bolso_politicas WHERE estado = 'aprovado' AND NOT teste) THEN
    RAISE EXCEPTION 'Geração real exige uma política comercial aprovada' USING ERRCODE = '22023';
  END IF;
  IF _dados ? 'limites' AND _dados -> 'limites' <> 'null'::jsonb THEN
    IF jsonb_typeof(_dados -> 'limites') <> 'object' OR EXISTS (SELECT 1 FROM unnest(ARRAY['paralelo_por_usuario', 'pedidos_por_dia_usuario', 'teto_global_dia']) k
      WHERE jsonb_typeof(_dados -> 'limites' -> k) IS DISTINCT FROM 'number' OR (_dados -> 'limites' ->> k)::numeric < 1 OR (_dados -> 'limites' ->> k)::numeric > 100000) THEN
      RAISE EXCEPTION 'Limites: paralelo_por_usuario, pedidos_por_dia_usuario e teto_global_dia, inteiros de 1 a 100000' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.bolso_config SET
    modulo_exposto = COALESCE((_dados ->> 'modulo_exposto')::boolean, modulo_exposto),
    geracao_real = COALESCE((_dados ->> 'geracao_real')::boolean, geracao_real),
    pagamentos = COALESCE((_dados ->> 'pagamentos')::boolean, pagamentos),
    modo_simulado = COALESCE((_dados ->> 'modo_simulado')::boolean, modo_simulado),
    kill_switch = COALESCE((_dados ->> 'kill_switch')::boolean, kill_switch),
    limites = CASE WHEN _dados ? 'limites' THEN NULLIF(_dados -> 'limites', 'null'::jsonb) ELSE limites END,
    destino_agencia = CASE WHEN _dados ? 'destino_agencia' THEN NULLIF(btrim(_dados ->> 'destino_agencia'), '') ELSE destino_agencia END,
    atualizado_por = a, atualizado_em = now()
  WHERE id;
  PERFORM bolso_privado.auditar('config', NULL, _dados);
  RETURN (SELECT to_jsonb(c) FROM public.bolso_config c WHERE id);
END $$;

-- Cria uma nova versão da política (sempre rascunho).
CREATE FUNCTION public.bolso_admin_politica_criar(_dados jsonb, _teste boolean, _nota text DEFAULT '') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); novo uuid;
BEGIN
  PERFORM bolso_privado.validar_politica(_dados);
  INSERT INTO public.bolso_politicas (versao, estado, teste, dados, nota, criado_por)
  VALUES (COALESCE((SELECT max(versao) FROM public.bolso_politicas), 0) + 1, 'rascunho', COALESCE(_teste, false),
    jsonb_build_object('creditos_iniciais', (_dados ->> 'creditos_iniciais')::int, 'tarifa_texto', (_dados ->> 'tarifa_texto')::int,
      'tarifa_imagem', (_dados ->> 'tarifa_imagem')::int, 'validade_meses', (_dados ->> 'validade_meses')::int, 'formatos', _dados -> 'formatos'),
    left(COALESCE(_nota, ''), 2000), a)
  RETURNING id INTO novo;
  PERFORM bolso_privado.auditar('politica_criada', novo::text, _dados);
  RETURN novo;
END $$;

-- Aprovar é decisão do dono: a política vira contrato e não muda mais.
CREATE FUNCTION public.bolso_admin_politica_aprovar(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin();
BEGIN
  UPDATE public.bolso_politicas SET estado = 'aprovado', aprovado_por = a, aprovado_em = now() WHERE id = _id AND estado = 'rascunho';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só um rascunho pode ser aprovado' USING ERRCODE = '22023'; END IF;
  PERFORM bolso_privado.auditar('politica_aprovada', _id::text, NULL);
END $$;

CREATE FUNCTION public.bolso_admin_politica_arquivar(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin();
BEGIN
  UPDATE public.bolso_politicas SET estado = 'arquivado' WHERE id = _id AND estado <> 'arquivado';
  PERFORM bolso_privado.auditar('politica_arquivada', _id::text, NULL);
END $$;

-- Concede um direito com os créditos iniciais da política (uma vez por referência).
CREATE FUNCTION bolso_privado.conceder(_user uuid, _tipo text, _origem text, _referencia text, _politica uuid, _inicio timestamptz, _ator uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.bolso_politicas; v_carteira text := CASE WHEN _tipo = 'teste' THEN 'teste' ELSE 'real' END; novo uuid; meses integer;
BEGIN
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

CREATE FUNCTION public.bolso_admin_conceder(_user uuid, _tipo text, _politica uuid, _referencia text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); novo uuid;
BEGIN
  IF _tipo NOT IN ('anual', 'teste') THEN RAISE EXCEPTION 'Pela administração: anual (validação manual) ou teste' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user) THEN RAISE EXCEPTION 'Pessoa não encontrada' USING ERRCODE = '22023'; END IF;
  novo := bolso_privado.conceder(_user, _tipo, CASE WHEN _tipo = 'teste' THEN 'teste' ELSE 'validacao_manual' END, btrim(_referencia), _politica, now(), a);
  IF novo IS NULL THEN RAISE EXCEPTION 'Esta referência já foi usada' USING ERRCODE = '22023'; END IF;
  PERFORM bolso_privado.auditar('direito_concedido', novo::text, jsonb_build_object('user_id', _user, 'tipo', _tipo, 'politica', _politica));
  RETURN novo;
END $$;

CREATE FUNCTION public.bolso_admin_revogar(_direito uuid, _motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); u uuid;
BEGIN
  UPDATE public.bolso_direitos SET revogado_em = now(), motivo_revogacao = left(COALESCE(_motivo, ''), 300)
  WHERE id = _direito AND revogado_em IS NULL RETURNING user_id INTO u;
  IF u IS NULL THEN RAISE EXCEPTION 'Direito não encontrado ou já revogado' USING ERRCODE = '22023'; END IF;
  PERFORM bolso_privado.expirar(u);
  PERFORM bolso_privado.auditar('direito_revogado', _direito::text, jsonb_build_object('motivo', _motivo));
END $$;

-- Reconciliação de job incerto: a administração decide depois de conferir no fornecedor.
CREATE FUNCTION public.bolso_admin_reconciliar(_job uuid, _decisao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a uuid := bolso_privado.exigir_admin(); j public.bolso_jobs;
BEGIN
  SELECT * INTO j FROM public.bolso_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL OR j.estado <> 'incerto' THEN RAISE EXCEPTION 'Só um pedido incerto é reconciliado' USING ERRCODE = '22023'; END IF;
  IF _decisao = 'liberar' THEN
    UPDATE public.bolso_jobs SET estado = 'falhou', erro = 'Conferido pela administração: não houve entrega.', atualizado_em = now() WHERE id = j.id;
    PERFORM bolso_privado.liberar(j, 'Liberado: conferido sem entrega');
  ELSIF _decisao = 'reenfileirar' THEN
    UPDATE public.bolso_jobs SET estado = 'na_fila', lease_ate = NULL, erro = NULL, atualizado_em = now() WHERE id = j.id;
  ELSE
    RAISE EXCEPTION 'Decisão: liberar ou reenfileirar' USING ERRCODE = '22023';
  END IF;
  PERFORM bolso_privado.auditar('job_reconciliado', _job::text, jsonb_build_object('decisao', _decisao));
END $$;

-- ─── Eventos de pagamento (contrato local, desligado) ──────────────────
-- Chamado só pelo servidor depois de autenticar o webhook do provedor.
-- Idempotente por (provedor, evento_id). Fora de ordem: reembolso antes da
-- aprovação deixa a referência bloqueada e a aprovação tardia não ativa.
-- Um pagamento concede o direito uma vez; nunca dispara geração.
CREATE FUNCTION public.bolso_evento_pagamento(_evento jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.bolso_config := bolso_privado.config(); prov text := _evento ->> 'provedor'; eid text := _evento ->> 'evento_id';
  tipo_ text := _evento ->> 'tipo'; v_produto text := _evento ->> 'produto'; ref text := _evento ->> 'referencia';
  u uuid := NULLIF(_evento ->> 'user_id', '')::uuid; quando timestamptz := (_evento ->> 'ocorrido_em')::timestamptz;
  v_impressao text := md5(concat_ws('|', prov, eid, tipo_, v_produto, ref, u, quando)); anterior public.bolso_eventos_pagamento;
  politica uuid; d public.bolso_direitos; res text;
BEGIN
  PERFORM bolso_privado.exigir_servico();
  SELECT * INTO anterior FROM public.bolso_eventos_pagamento WHERE provedor = prov AND evento_id = eid;
  IF anterior.id IS NOT NULL THEN
    IF anterior.impressao <> v_impressao THEN RAISE EXCEPTION 'Evento repetido com conteúdo diferente' USING ERRCODE = '22023'; END IF;
    RETURN 'repetido';
  END IF;
  INSERT INTO public.bolso_eventos_pagamento (provedor, evento_id, tipo, produto, referencia, user_id, impressao, ocorrido_em)
  VALUES (prov, eid, tipo_, v_produto, ref, u, v_impressao, quando);
  IF NOT c.pagamentos THEN res := 'guardado: pagamentos desligados';
  ELSIF tipo_ = 'aprovado' THEN
    IF EXISTS (SELECT 1 FROM public.bolso_eventos_pagamento WHERE referencia = ref AND provedor = prov AND tipo IN ('reembolsado', 'chargeback')) THEN
      res := 'ignorado: referência já reembolsada';
    ELSIF u IS NULL THEN res := 'guardado: sem pessoa vinculada';
    ELSE
      SELECT id INTO politica FROM public.bolso_politicas WHERE estado = 'aprovado' AND NOT teste ORDER BY versao DESC LIMIT 1;
      IF politica IS NULL THEN res := 'guardado: sem política aprovada';
      ELSIF bolso_privado.conceder(u, v_produto, 'pagamento', ref, politica, quando, NULL) IS NULL THEN res := 'repetido: direito já concedido';
      ELSE res := 'concedido'; END IF;
    END IF;
  ELSIF tipo_ IN ('reembolsado', 'chargeback') THEN
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

-- ─── Permissões ────────────────────────────────────────────────────────
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'bolso_estado()', 'bolso_extrato(integer)', 'bolso_marca_ler()', 'bolso_marca_salvar(jsonb,integer)',
    'bolso_campanha_salvar(jsonb,integer)', 'bolso_campanhas_listar()', 'bolso_campanha_ler(uuid)', 'bolso_versao_salvar(uuid,jsonb)',
    'bolso_versao_escolher(uuid,integer)', 'bolso_arte_escolher(uuid)', 'bolso_pedir(uuid,text,text,text,integer)', 'bolso_cancelar(uuid)',
    'bolso_admin_visao()', 'bolso_admin_config(jsonb)', 'bolso_admin_politica_criar(jsonb,boolean,text)', 'bolso_admin_politica_aprovar(uuid)',
    'bolso_admin_politica_arquivar(uuid)', 'bolso_admin_conceder(uuid,text,uuid,text)', 'bolso_admin_revogar(uuid,text)',
    'bolso_admin_reconciliar(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['bolso_trabalho_pegar(uuid,integer)', 'bolso_trabalho_concluir(uuid,integer,jsonb,jsonb,jsonb)',
    'bolso_trabalho_falhar(uuid,integer,text,boolean)', 'bolso_evento_pagamento(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bolso_privado FROM PUBLIC, anon, authenticated;

COMMIT;
