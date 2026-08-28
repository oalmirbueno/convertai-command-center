-- O alarme que ficou errado se desfaz sozinho.
--
-- O QUE ACONTECEU, e e culpa do desenho que eu entreguei primeiro:
--
-- O alarme de atraso rodou ANTES de existir a reconciliacao. Ele criou 15
-- avisos (5 publicacoes x 3 administradores). Depois a reconciliacao deu
-- baixa em 4 delas, com o endereco real do post que ja estava no ar.
--
-- Resultado: 12 avisos passaram a MENTIR. Eles dizem "passou da hora e
-- nao foi ao ar" sobre posts que foram, estao publicados e ja tem o link
-- no historico do cliente. E o alarme avisa uma vez so, de proposito,
-- entao ele nunca se corrigiria: a mentira ficaria no sino para sempre.
--
-- Isto e pior do que nao ter alarme. Aviso que erra e depois nao se
-- desfaz ensina a pessoa a ignorar TODOS os avisos, inclusive os certos.
--
-- A REGRA NOVA: o alarme de atraso e um aviso sobre um ESTADO, nao um
-- registro historico. Quando o estado deixa de existir — a publicacao
-- saiu da situacao "agendada" —, o aviso perde o assunto e vai embora.
-- Nao ha nada a preservar: o texto inteiro dele e "isto nao saiu", e
-- isso deixou de ser verdade.
--
-- O calendario e a verdade. O que o calendario diz que esta publicado,
-- esta publicado, e nenhum aviso pode contradizer isso.
--
-- Rodar de novo nao faz mal.

/**
 * Apaga aviso de atraso cujo assunto acabou.
 *
 * Escopo estreito de proposito: SO o tipo 'agendamento_atrasado', e SO
 * quando a publicacao que ele aponta nao esta mais agendada. Aviso de
 * outro tipo nao e tocado, e publicacao ainda agendada mantem o dela.
 */
create or replace function public.editorial_limpar_alertas_resolvidos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _apagados integer;
begin
  with resolvidos as (
    delete from public.notifications n
     where n.notification_type = 'agendamento_atrasado'
       and exists (
         select 1 from public.editorial_publications p
          where p.id::text = replace(n.link, '/calendario?publicacao=', '')
            and p.status <> 'scheduled'
       )
    returning 1
  )
  select count(*) into _apagados from resolvidos;

  return coalesce(_apagados, 0);
end;
$$;

revoke execute on function public.editorial_limpar_alertas_resolvidos() from anon;
grant execute on function public.editorial_limpar_alertas_resolvidos() to authenticated, service_role;

/**
 * O alarme espera 90 minutos, e nao 15.
 *
 * A corrida que sobrava: a coleta de metricas roda de 10 em 10 minutos, e
 * e ela que traz o post real do Instagram para o painel. Um post
 * publicado 09:53 pode so aparecer em social_post_metrics as 10:03. Se o
 * alarme dispara aos 15 minutos, ele fala ANTES de a reconciliacao ter
 * como saber — e, como o alarme nao se repete, o falso alarme ficava.
 *
 * Noventa minutos dao nove ciclos de coleta de folga. Um post 90 minutos
 * atrasado esta atrasado de verdade, e nada se perde em esperar: o
 * agendamento continua la, e o aviso chega no mesmo dia.
 *
 * A reconciliacao continua a partir dos 15 minutos: dar baixa cedo nao
 * tem risco nenhum, o risco todo estava em ACUSAR cedo.
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
             ), false) as arte_liberada,
           (select count(*) from public.social_post_metrics m
             where m.external_account_id = p.external_account_id
               and m.posted_at between p.scheduled_at - interval '30 minutes'
                                   and p.scheduled_at + interval '6 hours') as posts_na_janela
      from public.editorial_publications p
      left join public.editorial_posts po on po.id = p.post_id
     where p.status = 'scheduled'
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '90 minutes'
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

    _motivo := case
      when _pub.posts_na_janela > 1 then
        'o painel achou MAIS DE UM post na conta nessa janela e nao quis chutar qual e: confirme qual deles e este e de a baixa pelo painel'
      when not _pub.arte_liberada then
        'a arte ainda nao esta aprovada dos dois lados'
      when _pub.delivery_mode <> 'automatic' then
        'esta pronta e aprovada, o painel conferiu a conta e nao achou nenhum post nessa janela: publique, ou ligue a automacao dessa conta para sair sozinho'
      else
        'esta liberada e automatica, e mesmo assim nao saiu: verifique a conexao da conta'
    end;

    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id,
           format('Agendamento de %s passou da hora (%s) e o painel nao encontrou publicacao: %s',
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

/**
 * A ordem das tres etapas, e cada uma existe por um motivo.
 *
 *   1. RECONCILIA  — o painel aprende o que ja saiu, olhando a conta.
 *   2. LIMPA       — aviso sobre o que acabou de sair perde o assunto.
 *   3. ALARMA      — so entao sobra o que de fato nao saiu.
 *
 * Trocar 1 e 3 faz o alarme mentir. Tirar o 2 faz a mentira ficar, porque
 * o alarme nao se repete. As tres juntas, nesta ordem, e o que garante
 * que o sino so tenha coisa verdadeira.
 */
create or replace function public.editorial_conferir_agendamentos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _rec jsonb;
  _limpos integer;
  _ale jsonb;
begin
  _rec := public.editorial_reconciliar_publicados();
  _limpos := public.editorial_limpar_alertas_resolvidos();
  _ale := public.editorial_alerta_agendamento_atrasado();
  return jsonb_build_object(
    'reconciliacao', _rec,
    'avisos_desfeitos', _limpos,
    'alerta', _ale
  );
end;
$$;

revoke execute on function public.editorial_conferir_agendamentos() from anon;
grant execute on function public.editorial_conferir_agendamentos() to authenticated, service_role;

-- Limpeza imediata dos 12 que ja estao mentindo no sino. Idempotente: se
-- nao houver nenhum, apaga zero e segue.
select public.editorial_limpar_alertas_resolvidos();
