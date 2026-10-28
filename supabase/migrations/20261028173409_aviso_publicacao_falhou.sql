-- 28/10/2026 (dono: "certifique-se que nenhum outro vai travar mais"): o vídeo da Chilli Beans falhou às 14:00
-- com "Nao foi possivel assinar os arquivos" e o aviso de atraso só olhava a hora passada, sem o motivo do
-- motor. Agora toda publicação cujo job do motor falhou gera, uma vez, um aviso no sino dos admins com o erro
-- real e o link do post. Roda junto do editorial_conferir_agendamentos (a cada 15 min).
create or replace function public.editorial_alerta_publicacao_falhou()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _j record; _cliente text; _quando text; _link text; _avisados integer := 0;
begin
  for _j in
    select j.publication_id, j.last_error, p.client_id, p.post_id, p.scheduled_at, po.title as titulo
      from social_private.autopublish_jobs j
      join public.editorial_publications p on p.id = j.publication_id
      left join public.editorial_posts po on po.id = p.post_id
     where j.stage = 'failed'
       and j.updated_at > now() - interval '3 days'
       and p.status <> 'published'
       and not exists (
         select 1 from public.notifications n
          where n.notification_type = 'publicacao_falhou'
            and n.link like '%&publicacao=' || p.id::text
            and n.created_at >= j.updated_at)
     order by j.updated_at
     limit 50
  loop
    select coalesce(nullif(trim(pr.company_name), ''), pr.full_name) into _cliente from public.profiles pr where pr.id = _j.client_id;
    _quando := to_char(_j.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
    _link := '/calendario?client=' || _j.client_id::text || coalesce('&content=' || _j.post_id::text, '') || '&publicacao=' || _j.publication_id::text;
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Publicação de %s (%s, "%s") falhou ao ir ao ar: %s',
                  coalesce(_cliente, 'cliente'), _quando, left(coalesce(_j.titulo, 'post'), 80),
                  left(coalesce(nullif(_j.last_error, ''), 'o motor não informou o motivo'), 300)),
           'publicacao_falhou', _link
      from public.user_roles ur where ur.role = 'admin'::public.app_role;
    _avisados := _avisados + 1;
  end loop;
  return jsonb_build_object('avisados', _avisados, 'em', now());
end;
$$;

revoke all on function public.editorial_alerta_publicacao_falhou() from public, anon, authenticated;

create or replace function public.editorial_conferir_agendamentos()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _rec jsonb;
  _limpos integer;
  _ale jsonb;
  _falhas jsonb;
begin
  _rec := public.editorial_reconciliar_publicados();
  _limpos := public.editorial_limpar_alertas_resolvidos();
  _ale := public.editorial_alerta_agendamento_atrasado();
  _falhas := public.editorial_alerta_publicacao_falhou();
  return jsonb_build_object(
    'reconciliacao', _rec,
    'avisos_desfeitos', _limpos,
    'alerta', _ale,
    'falhas', _falhas
  );
end;
$function$;
