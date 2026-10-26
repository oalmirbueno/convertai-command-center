-- Post aprovado fica pronto para agendar (26/10/2026). Pedido do dono: "já era pra esse vídeo ter sido agendado,
-- porém ele está cinza mesmo aprovado; tem que ter o mesmo fluxo do carrossel, pronto para agendar; não dá pra
-- reprogramar, está preso; tire essa trava e deixe mais simples".
--
-- Causa: o "Preparar para publicar" da peça de vídeo criava o post como production_status 'draft'. Depois de
-- aprovado, o save_editorial_post recusa qualquer agendamento de post aprovado que não esteja 'ready'
-- ("approved editorial copy is immutable"), então Programar e Reagendar travavam para sempre.
--
-- 1) Gatilho: quando a aprovação do post é gravada (editorial_post_internal.approval_fingerprint deixa de ser
--    nula ou muda), o post em 'draft' passa para 'ready'. O estado de produção não entra na impressão digital
--    da aprovação, então a aprovação continua valendo.
-- 2) Conserto dos posts aprovados que ficaram em 'draft' (os vídeos de 25 e 26/10).
-- Idempotente.

create or replace function public.editorial_post_aprovado_fica_pronto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_fingerprint is not null and new.approval_fingerprint is distinct from old.approval_fingerprint then
    update public.editorial_posts set production_status = 'ready'
    where id = new.post_id and production_status = 'draft' and archived_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists editorial_post_aprovado_fica_pronto on public.editorial_post_internal;
create trigger editorial_post_aprovado_fica_pronto
  after update of approval_fingerprint on public.editorial_post_internal
  for each row execute function public.editorial_post_aprovado_fica_pronto();

update public.editorial_posts p set production_status = 'ready'
from public.editorial_post_internal i
where i.post_id = p.id
  and i.approval_fingerprint is not null
  and i.approval_fingerprint = public.editorial_compute_approval_fingerprint(p.id)
  and p.production_status = 'draft'
  and p.archived_at is null
  and p.created_at >= '2026-10-24';

-- Conferência (true):
-- select not exists (select 1 from public.editorial_posts p join public.editorial_post_internal i on i.post_id = p.id
--   where i.approval_fingerprint is not null and p.production_status = 'draft' and p.archived_at is null and p.created_at >= '2026-10-24');
