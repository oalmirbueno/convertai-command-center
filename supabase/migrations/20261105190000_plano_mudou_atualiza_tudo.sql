-- Mudou o plano, atualiza o resto sozinho (05/11/2026).
--
-- Dono: "caso o cliente faça um upgrade: clico no cliente, mudo de plano, coloco o valor e já atualiza automaticamente".
-- Vale para qualquer caminho que mude profiles.plan_value:
-- * a próxima mensalidade em aberto, ainda não vencida, passa para o valor novo. Paga e vencida ficam como estão: são história;
-- * o CRM acompanha: o valor do ganho é o do cadastro do cliente.

CREATE OR REPLACE FUNCTION public.plano_mudou_atualiza_cobranca_e_crm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_hoje date := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NEW.plan_value IS NOT DISTINCT FROM OLD.plan_value OR COALESCE(NEW.plan_value, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  UPDATE public.billing SET amount = NEW.plan_value
  WHERE client_id = NEW.id AND type = 'renewal' AND status = 'pending' AND paid_date IS NULL AND due_date >= v_hoje;

  UPDATE public.commercial_leads SET monthly_value = NEW.plan_value
  WHERE id = (
    SELECT l.id FROM public.commercial_leads l
    WHERE l.won_client_id = NEW.id AND l.stage = 'ganho' AND l.archived_at IS NULL
    ORDER BY (l.monthly_value > 0) DESC, l.closed_at DESC NULLS LAST
    LIMIT 1
  );
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.plano_mudou_atualiza_cobranca_e_crm() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_plano_mudou_trg ON public.profiles;
CREATE TRIGGER profiles_plano_mudou_trg
  AFTER UPDATE OF plan_value ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.plano_mudou_atualiza_cobranca_e_crm();
