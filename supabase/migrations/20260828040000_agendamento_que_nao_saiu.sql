-- O agendamento que passou da hora e nao saiu para de ser silencioso.
--
-- O RELATO do dono: "quando publicas alguns clientes nao avisa".
--
-- O QUE A AUDITORIA ACHOU, e nao era o aviso:
--
-- Existem publicacoes agendadas, com data no passado, com a arte aprovada
-- pela agencia E pelo cliente, que simplesmente NAO SAIRAM. Nao houve
-- falha, nao houve erro, nao houve fila: elas estao em
-- `delivery_mode = 'manual'`, e o publicador automatico so olha para
-- `automatic`. Entao ninguem publicou, e ninguem foi avisado de que
-- ninguem publicou. O post marcado para as 9h de terca simplesmente nao
-- aconteceu, e o painel seguiu com cara de normal.
--
-- Silencio e o pior estado possivel aqui. Falha avisada custa um
-- reagendamento; falha calada custa o cliente descobrindo sozinho que o
-- conteudo dele nao foi ao ar.
--
-- Esta migration NAO liga a automacao de ninguem. Publicar sozinho na
-- conta de um cliente e decisao do dono, conta por conta, e nao pode
-- nascer de um efeito colateral de migration. O que ela faz e garantir
-- que o atraso seja BARULHENTO.
--
-- Rodar de novo nao faz mal.

/**
 * Avisa sobre publicacao agendada que passou da hora e continua parada.
 *
 * Carencia de 15 minutos: o publicador automatico roda de minuto em
 * minuto e a entrega leva alguns segundos, entao avisar no segundo
 * seguinte ao horario geraria alarme falso em toda publicacao normal.
 *
 * Avisa UMA VEZ por publicacao. A marca fica na propria notificacao (o
 * link carrega o id), entao nao ha tabela nova para manter, e reprocessar
 * nao duplica.
 */
create or replace function public.editorial_alerta_agendamento_atrasado()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _pub record;
  _cliente text;
  _quando text;
  _motivo text;
  _avisados integer := 0;
begin
  for _pub in
    select p.id, p.client_id, p.platform, p.scheduled_at, p.delivery_mode,
           po.title as titulo,
           coalesce(
             public.editorial_file_is_publishable(
               coalesce(p.file_id, po.primary_file_id), p.client_id, p.project_id
             ), false) as arte_liberada
      from public.editorial_publications p
      left join public.editorial_posts po on po.id = p.post_id
     where p.status = 'scheduled'
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '15 minutes'
       -- Uma vez so: se ja existe aviso apontando para esta publicacao,
       -- nao repete. Sino que repete todo minuto vira sino que ninguem le.
       and not exists (
         select 1 from public.notifications n
          where n.notification_type = 'agendamento_atrasado'
            and n.link = '/calendario?publicacao=' || p.id::text
       )
     order by p.scheduled_at
     limit 200
  loop
    select coalesce(nullif(trim(pr.company_name), ''), pr.full_name)
      into _cliente
      from public.profiles pr where pr.id = _pub.client_id;

    _quando := to_char(_pub.scheduled_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');

    -- A mensagem diz O QUE FAZER, nao so que deu errado. Cada motivo tem
    -- uma saida diferente, e um aviso sem saida so gera aflicao.
    _motivo := case
      when _pub.delivery_mode <> 'automatic' and _pub.arte_liberada then
        'esta pronta e aprovada, mas a conta esta em modo manual: publique pelo painel ou ligue a automacao dessa conta'
      when _pub.delivery_mode <> 'automatic' then
        'esta em modo manual e a arte ainda nao esta liberada dos dois lados'
      when not _pub.arte_liberada then
        'nao saiu porque a arte ainda nao esta aprovada dos dois lados'
      else
        'esta liberada e automatica, mas nao saiu: verifique a conexao da conta'
    end;

    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Agendamento de %s passou da hora (%s) e nao foi ao ar: %s',
                  coalesce(_cliente, 'cliente'), _quando, _motivo),
           'agendamento_atrasado',
           '/calendario?publicacao=' || _pub.id::text
      from public.user_roles ur
     where ur.role = 'admin'::public.app_role;

    _avisados := _avisados + 1;
  end loop;

  return jsonb_build_object('avisados', _avisados, 'em', now());
end;
$$;

revoke execute on function public.editorial_alerta_agendamento_atrasado() from anon;
grant execute on function public.editorial_alerta_agendamento_atrasado() to authenticated, service_role;

-- De 15 em 15 minutos. Nao precisa ser de minuto em minuto: o que se
-- quer pegar e um atraso, e atraso nao fica mais urgente por ser visto
-- 14 minutos antes.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('editorial-agendamento-atrasado')
      where exists (select 1 from cron.job where jobname = 'editorial-agendamento-atrasado');
    perform cron.schedule(
      'editorial-agendamento-atrasado', '*/15 * * * *',
      $job$SELECT public.editorial_alerta_agendamento_atrasado();$job$
    );
  end if;
end
$cron$;
