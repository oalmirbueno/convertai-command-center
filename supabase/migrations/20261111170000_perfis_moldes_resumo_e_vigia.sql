-- Moldes do carrossel (11/11/2026, dono: "com avisos e com rotina para mim acompanhar").
-- Resumo semanal (segunda, depois da rodada dos perfis) e vigia diário que só fala quando
-- precisa: coleta parada, gasto perto do teto, perfil que saiu do ar, carteira sem saldo ou
-- conexão vencida. Os dois chegam no sino e por e-mail (equipe admin e gestor). Idempotente.

CREATE OR REPLACE FUNCTION public.notificacao_merece_email(_tipo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado', 'agendamento_atrasado', 'teste', 'acesso_pedido', 'perfis_resumo', 'perfis_alerta');
$function$;

CREATE OR REPLACE FUNCTION public.perfis_moldes_resumo_semanal(_teto_mes_usd numeric DEFAULT 5)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _lidos integer; _moldes integer; _pauta integer; _fila integer;
  _gasto_semana numeric; _gasto_mes numeric; _por_cliente text; _msg text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE molde IS NOT NULL),
         count(*) FILTER (WHERE molde IS NOT NULL
                            AND COALESCE((molde->>'ensina_sozinho')::boolean, false) = false
                            AND COALESCE((molde->>'serve')::numeric, 10) >= 5
                            AND jsonb_array_length(COALESCE(molde->'esqueleto', '[]'::jsonb)) >= 2)
    INTO _lidos, _moldes, _pauta
    FROM public.cliente_perfis_posts
   WHERE molde_em > now() - interval '7 days';

  SELECT string_agg(nome || ' ' || n, ', ' ORDER BY n DESC) INTO _por_cliente
    FROM (SELECT COALESCE(NULLIF(pr.company_name, ''), NULLIF(pr.full_name, ''), 'cliente') AS nome, count(*) AS n
            FROM public.cliente_perfis_posts po
            LEFT JOIN public.profiles pr ON pr.id = po.client_id
           WHERE po.molde_em > now() - interval '7 days' AND po.molde IS NOT NULL
           GROUP BY 1) x;

  SELECT count(*) INTO _fila
    FROM public.cliente_perfis_posts po
    JOIN public.cliente_perfis_instagram pi ON pi.id = po.perfil_id
   WHERE po.formato = 'carrossel' AND po.origem = 'api' AND po.molde_em IS NULL AND po.arquivado_em IS NULL
     AND pi.arquivado_em IS NULL AND pi.papel = 'referencia'
     AND (po.fora_da_curva OR COALESCE(po.vezes_a_mediana, 1) >= 1);

  SELECT COALESCE(sum(custo_usd), 0) INTO _gasto_semana
    FROM public.cliente_perfis_rodadas
   WHERE iniciada_em > now() - interval '7 days';

  SELECT COALESCE(sum(custo_usd), 0) INTO _gasto_mes
    FROM public.cliente_perfis_rodadas
   WHERE iniciada_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';

  _msg := format(
    'Carrosséis de referência na semana: %s lidos lâmina a lâmina, %s moldes novos, %s liberados para as pautas%s. Na fila para ler: %s. Gasto dos perfis: US$ %s na semana e US$ %s no mês (teto US$ %s).',
    _lidos, _moldes, _pauta,
    CASE WHEN _por_cliente IS NULL THEN '' ELSE ' (' || _por_cliente || ')' END,
    _fila,
    replace(to_char(_gasto_semana, 'FM990D00'), '.', ','), replace(to_char(_gasto_mes, 'FM990D00'), '.', ','), replace(to_char(_teto_mes_usd, 'FM990D00'), '.', ','));
  PERFORM public.avisar_equipe(_msg, 'perfis_resumo', '/mesa');
  RETURN _msg;
END;
$function$;

CREATE OR REPLACE FUNCTION public.perfis_moldes_vigia(_teto_mes_usd numeric DEFAULT 5)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _partes text[] := ARRAY[]::text[];
  _t text; _n integer; _gasto numeric; _msg text;
BEGIN
  -- Coleta parada: referência lida pela API que passou do dia da rodada há mais de 2 dias.
  SELECT count(*), string_agg('@' || handle, ', ' ORDER BY handle) INTO _n, _t
    FROM public.cliente_perfis_instagram
   WHERE arquivado_em IS NULL AND papel = 'referencia' AND origem = 'api'
     AND proxima_rodada_em IS NOT NULL AND proxima_rodada_em < now() - interval '2 days';
  IF _n > 0 THEN _partes := _partes || format('coleta parada em %s %s (%s)', _n, CASE WHEN _n = 1 THEN 'perfil' ELSE 'perfis' END, left(_t, 160)); END IF;

  -- Perfil que saiu do ar: já foi capturado pela API e agora o Instagram não devolve.
  SELECT count(*), string_agg('@' || handle, ', ' ORDER BY handle) INTO _n, _t
    FROM public.cliente_perfis_instagram
   WHERE arquivado_em IS NULL AND origem = 'api' AND capturado_em IS NOT NULL
     AND (ultimo_erro ILIKE 'Não foi possível ler este @%' OR ultimo_erro ILIKE 'O Instagram não devolveu este perfil%');
  IF _n > 0 THEN _partes := _partes || format('%s saiu do ar ou virou conta fechada (%s)', CASE WHEN _n = 1 THEN 'perfil' ELSE _n || ' perfis' END, left(_t, 160)); END IF;

  -- Carteira de IA sem saldo: a leitura da semana não rodou.
  SELECT count(DISTINCT pi.client_id), string_agg(DISTINCT COALESCE(NULLIF(pr.company_name, ''), NULLIF(pr.full_name, ''), 'cliente'), ', ') INTO _n, _t
    FROM public.cliente_perfis_instagram pi
    LEFT JOIN public.profiles pr ON pr.id = pi.client_id
   WHERE pi.arquivado_em IS NULL AND pi.ultimo_erro ILIKE 'Saldo insuficiente%';
  IF _n > 0 THEN _partes := _partes || format('carteira de IA sem saldo para ler os perfis de %s', left(_t, 160)); END IF;

  -- Conexão do Instagram vencida.
  SELECT count(*) INTO _n FROM public.cliente_perfis_instagram
   WHERE arquivado_em IS NULL AND (ultimo_erro ILIKE 'A conexão do Instagram venceu%' OR ultimo_erro ILIKE 'A conta conectada não tem permissão%');
  IF _n > 0 THEN _partes := _partes || format('conexão do Instagram vencida ou sem permissão em %s %s', _n, CASE WHEN _n = 1 THEN 'perfil' ELSE 'perfis' END); END IF;

  -- Gasto do mês perto do teto (80%).
  SELECT COALESCE(sum(custo_usd), 0) INTO _gasto
    FROM public.cliente_perfis_rodadas
   WHERE iniciada_em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  IF _teto_mes_usd > 0 AND _gasto >= _teto_mes_usd * 0.8 THEN
    _partes := _partes || format('gasto dos perfis no mês em US$ %s, perto do teto de US$ %s', replace(to_char(_gasto, 'FM990D00'), '.', ','), replace(to_char(_teto_mes_usd, 'FM990D00'), '.', ','));
  END IF;

  IF array_length(_partes, 1) IS NULL THEN RETURN NULL; END IF;
  _msg := 'Perfis do Instagram precisam de você: ' || array_to_string(_partes, '; ') || '.';
  -- O mesmo aviso não se repete por 6 dias.
  IF EXISTS (SELECT 1 FROM public.notifications WHERE notification_type = 'perfis_alerta' AND message = left(_msg, 500) AND created_at > now() - interval '6 days') THEN
    RETURN NULL;
  END IF;
  PERFORM public.avisar_equipe(_msg, 'perfis_alerta', '/mesa');
  RETURN _msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.perfis_moldes_resumo_semanal(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.perfis_moldes_vigia(numeric) FROM PUBLIC, anon, authenticated;

-- Agenda: resumo na segunda às 12h30 de Brasília (a rodada dos perfis termina às 11h17) e vigia todo dia às 9h40.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('perfis-moldes-resumo-semanal', 'perfis-moldes-vigia');
  PERFORM cron.schedule('perfis-moldes-resumo-semanal', '30 15 * * 1', 'select public.perfis_moldes_resumo_semanal(5);');
  PERFORM cron.schedule('perfis-moldes-vigia', '40 12 * * *', 'select public.perfis_moldes_vigia(5);');
END $$;
