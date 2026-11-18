-- Vigia dos e-mails (18/11/2026, pedido do dono: "os e-mails não estão enviando; não pode ficar ruim
-- assim, sempre tem que enviar").
--
-- De 13/11 20h40 a 18/11 o Resend recusou TODO e-mail ("domínio não verificado") e ninguém soube: o
-- envio entra numa fila e a falha acontece depois, longe da tela que mandou. Esta vigia olha a fila de
-- hora em hora e, quando os e-mails estão falhando e nenhum saiu, avisa quem administra no sino do
-- painel (o sino não depende do e-mail), no máximo uma vez a cada 12 horas, com o erro do provedor.
-- Quando volta a sair, avisa uma vez que normalizou.

create table if not exists app_private.vigia_dos_emails (
  id boolean primary key default true check (id),
  em_falha boolean not null default false,
  avisado_em timestamptz,
  ultimo_erro text
);
insert into app_private.vigia_dos_emails (id) values (true) on conflict do nothing;
revoke all on app_private.vigia_dos_emails from public, anon, authenticated;

create or replace function public.vigiar_emails()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _v app_private.vigia_dos_emails;
  _falhas integer;
  _enviados integer;
  _erro text;
begin
  select * into _v from app_private.vigia_dos_emails where id for update;
  select count(*) filter (where l.status in ('dlq', 'failed', 'bounced') or (l.status = 'pending' and l.created_at < now() - interval '30 minutes')),
         count(*) filter (where l.status = 'sent')
    into _falhas, _enviados
    from public.email_send_log l
   where l.created_at > now() - interval '3 hours';
  select left(l.error_message, 200) into _erro
    from public.email_send_log l
   where l.created_at > now() - interval '3 hours' and l.error_message is not null
   order by l.created_at desc limit 1;

  if _falhas > 0 and _enviados = 0 then
    if not _v.em_falha or _v.avisado_em is null or _v.avisado_em < now() - interval '12 hours' then
      perform public.produto_avisar_casa(
        format('E-mails não estão saindo: %s falharam nas últimas 3 horas e nenhum foi entregue. Motivo: %s',
               _falhas, coalesce(_erro, 'sem detalhe do provedor')),
        '/dashboard');
      update app_private.vigia_dos_emails set em_falha = true, avisado_em = now(), ultimo_erro = _erro where id;
      return 'avisado';
    end if;
    return 'em falha, ja avisado';
  end if;

  if _v.em_falha and _enviados > 0 then
    perform public.produto_avisar_casa('Os e-mails voltaram a sair normalmente.', '/dashboard');
    update app_private.vigia_dos_emails set em_falha = false, avisado_em = now() where id;
    return 'normalizou';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.vigiar_emails() from public, anon, authenticated;
grant execute on function public.vigiar_emails() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('vigia-dos-emails');
    exception when others then null;
    end;
    perform cron.schedule('vigia-dos-emails', '7 * * * *', 'select public.vigiar_emails();');
  end if;
end;
$$;
