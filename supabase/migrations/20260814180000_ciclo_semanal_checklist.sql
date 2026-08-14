-- Checklist de bolso do dono: o ciclo semanal por cliente (Social Media e
-- Trafego Pago), com estrelas de progresso. Cada marcacao vive no banco e
-- fica sincronizada com o painel; semana e segunda a domingo.

CREATE TABLE IF NOT EXISTS public.weekly_cycle_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  area text NOT NULL CHECK (area IN ('social', 'trafego')),
  week_start date NOT NULL,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 10),
  done_by uuid,
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, area, week_start, step)
);

CREATE INDEX IF NOT EXISTS weekly_cycle_progress_week_idx
  ON public.weekly_cycle_progress (week_start, area, client_id);

ALTER TABLE public.weekly_cycle_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_cycle_staff_read ON public.weekly_cycle_progress;
CREATE POLICY weekly_cycle_staff_read ON public.weekly_cycle_progress
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS weekly_cycle_admin_write ON public.weekly_cycle_progress;
CREATE POLICY weekly_cycle_admin_write ON public.weekly_cycle_progress
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

DROP POLICY IF EXISTS weekly_cycle_admin_delete ON public.weekly_cycle_progress;
CREATE POLICY weekly_cycle_admin_delete ON public.weekly_cycle_progress
  FOR DELETE TO authenticated
  USING (
    (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'manager'::public.app_role))
    AND public.can_access_client(client_id)
  );

GRANT SELECT, INSERT, DELETE ON public.weekly_cycle_progress TO authenticated;
REVOKE ALL ON public.weekly_cycle_progress FROM anon;
