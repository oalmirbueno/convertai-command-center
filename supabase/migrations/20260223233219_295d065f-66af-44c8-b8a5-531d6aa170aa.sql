-- Add UPDATE policy for billing (admin needs to mark as paid)
CREATE POLICY "billing_update" ON public.billing
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add UPDATE policy for recharge_requests so clients can also update (approve/reject)
DROP POLICY IF EXISTS "recharge_requests_update" ON public.recharge_requests;
CREATE POLICY "recharge_requests_update" ON public.recharge_requests
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR client_id = auth.uid()
);