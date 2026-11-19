-- Automações por cliente (19/11/2026). Dono: "uma pasta para automações de cliente dentro de cada cliente: as
-- automações da Aceleriq e as automações de clientes, tudo organizadinho".
--
-- Fluxo do n8n feito PARA um cliente (ex.: Grupos DK) ganha dono: automacao_fluxo_cliente liga o fluxo ao
-- cliente (profiles.id). Sem ligação, o fluxo é da Aceleriq (serve a casa ou todos os clientes). Só o dono (admin)
-- liga e desliga essa ligação, pela RPC automacoes_definir_cliente. A leitura (automacoes_painel e
-- automacoes_fluxo) passa a trazer client_id e o nome do cliente.

CREATE TABLE IF NOT EXISTS public.automacao_fluxo_cliente (
  fluxo_id text PRIMARY KEY,
  client_id uuid NOT NULL,
  definido_por uuid,
  definido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automacao_fluxo_cliente_client_idx ON public.automacao_fluxo_cliente (client_id);
ALTER TABLE public.automacao_fluxo_cliente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automacao_fluxo_cliente FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.automacao_fluxo_cliente TO service_role;

-- Os fluxos dos Grupos DK são do cliente Vip DK (plataforma de sorteios dele).
INSERT INTO public.automacao_fluxo_cliente (fluxo_id, client_id)
SELECT f.id, p.id
FROM public.automacao_fluxos f
JOIN public.profiles p ON p.id = 'eae16e8d-174a-4f4c-9613-4944571f7235'::uuid
WHERE f.grupo = 'Grupos DK'
ON CONFLICT (fluxo_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.automacao_nome_do_cliente(_client_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), 'Cliente')
  FROM public.profiles p WHERE p.id = _client_id;
$function$;

CREATE OR REPLACE FUNCTION public.automacoes_painel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_staff(_uid), false) THEN
    RAISE EXCEPTION 'Somente a equipe vê as automações.' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'coleta', (SELECT jsonb_build_object('coletado_em', c.coletado_em, 'recebido_em', c.recebido_em,
                 'atrasada', c.recebido_em < now() - interval '5 minutes') FROM public.automacao_coletas c WHERE c.id = 1),
    'pode_ligar', coalesce(auth.role(), '') = 'service_role' OR coalesce(public.has_role(_uid, 'admin'::public.app_role), false),
    'fluxos', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'nome', f.nome, 'grupo', f.grupo, 'ativo', f.ativo, 'arquivado', f.arquivado,
        'gatilhos', f.gatilhos, 'proxima_execucao', f.proxima_execucao, 'total_24h', f.total_24h,
        'erros_24h', f.erros_24h, 'ultima_execucao', f.ultima_execucao, 'qtd_nos', f.qtd_nos,
        'atualizado_no_n8n', f.atualizado_no_n8n,
        'efeito_no_cliente', public.automacao_efeito_no_cliente(f.grupo, f.nome),
        'client_id', fc.client_id,
        'cliente', CASE WHEN fc.client_id IS NULL THEN NULL ELSE public.automacao_nome_do_cliente(fc.client_id) END
      ) ORDER BY f.grupo, f.nome)
      FROM public.automacao_fluxos f
      LEFT JOIN public.automacao_fluxo_cliente fc ON fc.fluxo_id = f.id
      WHERE f.sumiu_em IS NULL), '[]'::jsonb),
    'saude', coalesce((SELECT jsonb_agg(jsonb_build_object('chave', s.chave, 'nome', s.nome, 'estado', s.estado,
        'detalhe', s.detalhe, 'info', s.info, 'coletado_em', s.coletado_em) ORDER BY s.ordem, s.chave)
      FROM public.automacao_saude s), '[]'::jsonb),
    'acoes', coalesce((SELECT jsonb_agg(a ORDER BY a->>'created_at' DESC) FROM (
        SELECT jsonb_build_object('fluxo_id', x.fluxo_id, 'fluxo_nome', x.fluxo_nome, 'acao', x.acao,
          'pedido_por_nome', x.pedido_por_nome, 'via', x.via, 'resultado', x.resultado, 'erro', x.erro,
          'created_at', x.created_at) AS a
        FROM public.automacao_acoes x ORDER BY x.created_at DESC LIMIT 20) t), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.automacoes_fluxo(_id text, _limite integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _f public.automacao_fluxos;
  _cliente uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'Somente a equipe vê as automações.' USING errcode = '42501';
  END IF;
  SELECT * INTO _f FROM public.automacao_fluxos WHERE id = _id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT client_id INTO _cliente FROM public.automacao_fluxo_cliente WHERE fluxo_id = _id;
  RETURN jsonb_build_object(
    'id', _f.id, 'nome', _f.nome, 'grupo', _f.grupo, 'ativo', _f.ativo, 'gatilhos', _f.gatilhos,
    'proxima_execucao', _f.proxima_execucao, 'total_24h', _f.total_24h, 'erros_24h', _f.erros_24h,
    'efeito_no_cliente', public.automacao_efeito_no_cliente(_f.grupo, _f.nome),
    'client_id', _cliente,
    'cliente', CASE WHEN _cliente IS NULL THEN NULL ELSE public.automacao_nome_do_cliente(_cliente) END,
    'desenho', coalesce(_f.desenho, '{}'::jsonb),
    'execucoes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'modo', e.modo, 'status', e.status,
        'inicio', e.inicio, 'fim', e.fim, 'caminho', e.caminho, 'parou_em', e.parou_em, 'erro', e.erro,
        'erro_no', e.erro_no, 'grande', e.grande) ORDER BY e.id DESC)
      FROM (SELECT * FROM public.automacao_execucoes WHERE fluxo_id = _id ORDER BY id DESC
            LIMIT greatest(1, least(coalesce(_limite, 30), 100))) e), '[]'::jsonb),
    'acoes', coalesce((SELECT jsonb_agg(jsonb_build_object('acao', a.acao, 'pedido_por_nome', a.pedido_por_nome,
        'via', a.via, 'resultado', a.resultado, 'erro', a.erro, 'created_at', a.created_at) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.automacao_acoes WHERE fluxo_id = _id ORDER BY created_at DESC LIMIT 10) a), '[]'::jsonb)
  );
END;
$function$;

-- Só o dono diz de quem é o fluxo. _client_id nulo devolve o fluxo para a Aceleriq.
CREATE OR REPLACE FUNCTION public.automacoes_definir_cliente(_fluxo_id text, _client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.has_role(_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'Só o dono diz de quem é a automação.' USING errcode = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.automacao_fluxos WHERE id = _fluxo_id) THEN
    RAISE EXCEPTION 'Fluxo não encontrado.' USING errcode = 'P0002';
  END IF;
  IF _client_id IS NULL THEN
    DELETE FROM public.automacao_fluxo_cliente WHERE fluxo_id = _fluxo_id;
    RETURN jsonb_build_object('fluxo_id', _fluxo_id, 'client_id', NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _client_id AND r.role = 'client'::public.app_role) THEN
    RAISE EXCEPTION 'Esse cliente não existe.' USING errcode = 'P0002';
  END IF;
  INSERT INTO public.automacao_fluxo_cliente (fluxo_id, client_id, definido_por)
  VALUES (_fluxo_id, _client_id, _uid)
  ON CONFLICT (fluxo_id) DO UPDATE SET client_id = EXCLUDED.client_id, definido_por = EXCLUDED.definido_por, definido_em = now();
  RETURN jsonb_build_object('fluxo_id', _fluxo_id, 'client_id', _client_id, 'cliente', public.automacao_nome_do_cliente(_client_id));
END;
$function$;

REVOKE ALL ON FUNCTION public.automacao_nome_do_cliente(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automacao_nome_do_cliente(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.automacoes_definir_cliente(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automacoes_definir_cliente(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.automacoes_painel() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.automacoes_fluxo(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.automacoes_painel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.automacoes_fluxo(text, integer) TO authenticated, service_role;
