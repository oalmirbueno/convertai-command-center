-- 04/11/2026: conserto de acento (E02). A migration de 27/10 (cobranca_pausada_por_cliente) gravou
-- a palavra Cobrança com dupla codificação (UTF-8 lido como Latin-1) na descrição padrão da régua. Mesmo corpo, só o acento certo.

CREATE OR REPLACE FUNCTION app_private.cobranca_candidatos(_hoje date)
 RETURNS TABLE(client_id uuid, cliente text, itens jsonb, etapa integer, grupo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH aberto AS (
    SELECT b.id, b.client_id, b.amount, b.due_date,
           COALESCE(NULLIF(btrim(regexp_replace(COALESCE(b.description, ''), '\s*\([^)]*\)\s*$', '')), ''),
                    CASE b.type WHEN 'renewal' THEN 'Mensalidade' ELSE 'Cobrança' END) AS descricao,
           (_hoje - b.due_date) AS dias,
           app_private.cobranca_etapa(_hoje - b.due_date) AS etapa
      FROM public.billing b
      JOIN public.profiles p ON p.id = b.client_id
     WHERE b.status = 'pending'
       AND b.due_date < _hoje
       AND b.amount > 0
       AND p.deleted_at IS NULL
       AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
       AND NOT COALESCE(p.cobranca_pausada, false)
  ), marcado AS (
    SELECT a.*,
           NOT EXISTS (
             SELECT 1 FROM public.mensagem_automatica m
              WHERE m.tipo = 'cobranca' AND m.client_id = a.client_id AND m.status <> 'cancelado'
                AND m.itens @> jsonb_build_array(jsonb_build_object('billing_id', a.id::text, 'etapa', a.etapa, 'marco', true))
           ) AS novo
      FROM aberto a
  )
  SELECT m.client_id,
         app_private.nome_do_cliente(m.client_id),
         jsonb_agg(jsonb_build_object('billing_id', m.id::text, 'descricao', m.descricao, 'valor', m.amount,
                                      'vencimento', m.due_date, 'dias', m.dias, 'etapa', m.etapa, 'marco', m.novo)
                   ORDER BY m.due_date, m.id),
         max(m.etapa) FILTER (WHERE m.novo),
         app_private.grupo_whatsapp_do_cliente(m.client_id)
    FROM marcado m
   GROUP BY m.client_id
  HAVING bool_or(m.novo);
$function$;

REVOKE ALL ON FUNCTION app_private.cobranca_candidatos(date) FROM PUBLIC, anon, authenticated;
