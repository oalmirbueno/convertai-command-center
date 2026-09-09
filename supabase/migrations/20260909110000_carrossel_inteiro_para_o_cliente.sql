-- O carrossel chegava ao cliente com uma imagem so.
--
-- can_client_read_file exigia que cada card filho tivesse requires_approval
-- falso. Mas 205 dos 383 cards filhos em aprovacao nasceram com a flag
-- herdada do pai (true), e a RLS os escondia do cliente: no celular aparecia
-- so a capa, sem as setas, e o cliente aprovava sem ver o resto.
--
-- O card filho nunca e aprovado sozinho: quem manda e o pai (root). Entao a
-- flag do filho nao decide nada e sai da regra. O resto continua igual: mesma
-- visibilidade, mesmo status interno, mesmo cliente, pai aprovado pela agencia.

CREATE OR REPLACE FUNCTION public.can_client_read_file(_file_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'client'::public.app_role)
    AND f.client_id = root.client_id
    AND f.archived_at IS NULL
    AND COALESCE(f.status, 'ready') = 'ready'
    AND root.client_id = auth.uid()
    AND root.archived_at IS NULL
    AND COALESCE(root.status, 'ready') = 'ready'
    AND root.agency_approval_status = 'approved'
    AND (
      f.id = root.id
      OR (
        f.parent_file_id = root.id
        AND f.visibility = root.visibility
        AND f.agency_approval_status = root.agency_approval_status
        AND f.approval_status = 'none'
      )
    )
    AND (
      root.visibility = 'client_shared'
      OR (
        root.visibility = 'approval'
        AND root.approval_status IN ('pending', 'approved', 'rejected')
      )
    )
  FROM public.files AS f
  JOIN public.files AS root
    ON root.id = COALESCE(f.parent_file_id, f.id)
  WHERE f.id = _file_id
$function$;

do $chk$
begin
  if position('NOT COALESCE(f.requires_approval' in pg_get_functiondef('public.can_client_read_file'::regproc)) > 0 then
    raise exception 'can_client_read_file ainda esconde filhos com requires_approval';
  end if;
end $chk$;
