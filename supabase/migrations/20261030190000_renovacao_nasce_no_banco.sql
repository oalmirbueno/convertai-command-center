-- 30/10/2026 (dono: "sim, corrija no painel a renovação que não é gerada").
-- A próxima cobrança de renovação só nascia no clique "registrar pagamento" do
-- AdminFinanceiro. Pagamento marcado por outro caminho (MCP, Hermes, saldo de
-- parcial quitado, "Recebi" da ficha do cliente, SQL) não avançava
-- profiles.plan_renewal_date nem criava o billing do mês seguinte: Preserva Eco,
-- Verzelo e Softy ficaram sem a cobrança de novembro.
--
-- Agora o banco faz isso quando uma cobrança de renovação vira 'paid', venha de
-- onde vier. O front deixou de repetir o trabalho.
--
-- Regras:
--   * Só para cliente ativo: plan_status inactive/standby não gera, nem cliente
--     apagado, nem empresa do grupo (services_config.internal_company). É a
--     mesma "recorrência pausada" do financeiro (aceleriq-finance-services.ts).
--     profiles.cobranca_pausada NÃO bloqueia: ela só cala a régua de cobrança;
--     o cliente continua pagando e a próxima mensalidade precisa existir.
--   * Sem plan_renewal_date não há ciclo para avançar.
--   * Só avança quando a cobrança paga é do ciclo atual ou à frente
--     (due_date >= plan_renewal_date). Pagar uma cobrança velha atrasada não
--     pula o ciclo atual. Nova data = maior(plan_renewal_date, due_date) + 1 mês.
--   * overdue_since só é limpo se não sobrar cobrança vencida em aberto.
--   * Projetos 'paused' do cliente voltam para 'active' (como o front fazia; o
--     front gravava 'in_progress', que não é status de projeto no painel).
--   * A próxima cobrança só nasce se não existir renovação não cancelada do
--     mesmo cliente com o mesmo vencimento.
-- Idempotente: pagar de novo (ou desfazer e pagar) a mesma cobrança não avança,
-- porque depois do primeiro avanço o vencimento dela fica atrás do ciclo.

CREATE SCHEMA IF NOT EXISTS app_private;

CREATE OR REPLACE FUNCTION app_private.renovacao_ao_pagar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _perfil record;
  _hoje date := (pg_catalog.now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _nova date;
  _ainda_vencida boolean;
BEGIN
  IF NEW.type IS DISTINCT FROM 'renewal'
     OR NEW.status IS DISTINCT FROM 'paid'
     OR OLD.status IS NOT DISTINCT FROM 'paid' THEN
    RETURN NULL;
  END IF;

  -- Trava o perfil: dois pagamentos do mesmo cliente ao mesmo tempo avançam
  -- um de cada vez.
  SELECT p.id, p.plan_status, p.plan_renewal_date, p.plan_value, p.plan_name,
         p.overdue_since, p.deleted_at, p.services_config
    INTO _perfil
    FROM public.profiles AS p
   WHERE p.id = NEW.client_id
   FOR UPDATE;

  IF NOT FOUND
     OR _perfil.deleted_at IS NOT NULL
     OR _perfil.plan_renewal_date IS NULL
     OR COALESCE(_perfil.plan_status, '') IN ('inactive', 'standby')
     OR COALESCE((_perfil.services_config ->> 'internal_company')::boolean, false) THEN
    RETURN NULL;
  END IF;

  IF NEW.due_date < _perfil.plan_renewal_date THEN
    RETURN NULL;
  END IF;

  _nova := (GREATEST(_perfil.plan_renewal_date, NEW.due_date) + INTERVAL '1 month')::date;

  _ainda_vencida := EXISTS (
    SELECT 1 FROM public.billing AS b
     WHERE b.client_id = NEW.client_id
       AND b.id <> NEW.id
       AND b.status = 'pending'
       AND b.type IS DISTINCT FROM 'ads_recharge'
       AND b.amount > 0
       AND b.due_date < _hoje
  );

  UPDATE public.profiles AS p
     SET plan_renewal_date = _nova,
         overdue_since = CASE WHEN _ainda_vencida THEN p.overdue_since ELSE NULL END
   WHERE p.id = NEW.client_id;

  UPDATE public.projects AS pr
     SET status = 'active'
   WHERE pr.client_id = NEW.client_id
     AND pr.status = 'paused'
     AND pr.deleted_at IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.billing AS b
     WHERE b.client_id = NEW.client_id
       AND b.type = 'renewal'
       AND b.status IS DISTINCT FROM 'cancelled'
       AND b.due_date = _nova
  ) THEN
    INSERT INTO public.billing (client_id, type, amount, due_date, description)
    VALUES (
      NEW.client_id,
      'renewal',
      COALESCE(NULLIF(_perfil.plan_value, 0), NULLIF(NEW.paid_amount, 0), NEW.amount),
      _nova,
      CASE WHEN NULLIF(pg_catalog.btrim(_perfil.plan_name), '') IS NOT NULL
           THEN 'Renovação · ' || pg_catalog.btrim(_perfil.plan_name)
           ELSE 'Renovação Mensal' END
    );
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION app_private.renovacao_ao_pagar() IS
  'Renovação paga avança plan_renewal_date em 1 mês e cria a próxima cobrança (idempotente). Gatilho billing_renovacao_ao_pagar.';

REVOKE ALL ON FUNCTION app_private.renovacao_ao_pagar() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.renovacao_ao_pagar() FROM anon, authenticated;

DROP TRIGGER IF EXISTS billing_renovacao_ao_pagar ON public.billing;
CREATE TRIGGER billing_renovacao_ao_pagar
  AFTER UPDATE OF status ON public.billing
  FOR EACH ROW
  WHEN (NEW.type = 'renewal' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION app_private.renovacao_ao_pagar();
