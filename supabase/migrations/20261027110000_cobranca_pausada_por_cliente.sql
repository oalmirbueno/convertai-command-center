-- 27/10/2026 (dono): pausar a régua de cobrança de um cliente específico (ex.: Terra Flor avisou que vai acertar).
-- profiles.cobranca_pausada = true tira o cliente dos candidatos da cobrança; o resto da régua segue igual.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cobranca_pausada boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.profiles.cobranca_pausada IS 'Régua de cobrança pausada para este cliente (decisão do dono).';

CREATE OR REPLACE FUNCTION app_private.cobranca_candidatos(_hoje date)
 RETURNS TABLE(client_id uuid, cliente text, itens jsonb, etapa integer, grupo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH aberto AS (
    SELECT b.id, b.client_id, b.amount, b.due_date,
           COALESCE(NULLIF(btrim(regexp_replace(COALESCE(b.description, ''), '\s*\([^)]*\)\s*$', '')), ''),
                    CASE b.type WHEN 'renewal' THEN 'Mensalidade' ELSE 'CobranÃ§a' END) AS descricao,
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
