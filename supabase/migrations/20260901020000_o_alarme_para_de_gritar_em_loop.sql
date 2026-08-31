-- ═══════════════════════════════════════════════════════════════════════
-- O ALARME ESTAVA EM LOOP, E A CULPA E DA MINHA PROPRIA CORRECAO.
--
-- Ao ampliar o alarme para enxergar `planned` (o ponto cego que deixou os
-- posts da aJenda passarem), eu esqueci da limpeza. Ela apaga alertas de
-- publicacao com `status <> 'scheduled'` — o que inclui `planned`.
--
-- O ciclo:
--   1. o alarme cria o aviso de uma publicacao `planned`;
--   2. a limpeza ve `planned <> scheduled` e APAGA;
--   3. quinze minutos depois o alarme cria de novo, porque a deduplicacao
--      procura um aviso que ja nao existe.
--
-- Resultado: tres rascunhos da AcelerIQ de 27/07, vezes tres admins,
-- renascendo a cada quinze minutos. Alarme que grita em loop treina quem
-- le a ignorar alarme — que e exatamente o oposto do que eu quis fazer.
--
-- Duas correcoes, e a segunda importa tanto quanto:
--
--  A) A limpeza so apaga o que FOI RESOLVIDO de verdade: publicado ou
--     cancelado. `planned` e `scheduled` continuam alarmaveis, porque
--     ainda nao aconteceram.
--
--  B) Rascunho velho sem arte deixa de alarmar. Uma publicacao `planned`
--     SEM ARTE de cinco semanas atras nao e um post que faltou: e um
--     rascunho abandonado. Cobrar isso todo dia e ruido que esconde o
--     alarme real. Com arte, continua alarmando sempre — ali houve
--     intencao de publicar.
--
-- Nao altera publicacoes, conteudo nem horarios. Rollback: restaurar as
-- duas funcoes anteriores.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.editorial_limpar_alertas_resolvidos()
returns integer
language plpgsql
security definer
set search_path to 'public'
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
            -- RESOLVIDO e publicado ou cancelado. `planned` nao e
            -- resolucao: e a publicacao ainda parada, e apagar o aviso
            -- dela fazia o alarme renascer no ciclo seguinte.
            and p.status in ('published', 'cancelled')
       )
    returning 1
  )
  select count(*) into _apagados from resolvidos;
  return coalesce(_apagados, 0);
end;
$$;

-- Limpa o que o loop ja deixou para tras, so dos rascunhos sem arte que
-- deixarao de alarmar. Aviso de publicacao com arte permanece.
delete from public.notifications n
 where n.notification_type = 'agendamento_atrasado'
   and exists (
     select 1
       from public.editorial_publications p
       left join public.editorial_posts po on po.id = p.post_id
      where p.id::text = replace(n.link, '/calendario?publicacao=', '')
        and p.status = 'planned'
        and coalesce(p.file_id, po.primary_file_id) is null
   );

-- ─── B) Rascunho velho sem arte para de alarmar ─────────────────────────
--
-- Patch textual sobre a definicao viva: o alarme tem uma escada de motivos
-- construida em cima de casos reais, e reescreve-la para mudar o filtro
-- seria arriscar todos eles.
do $patch$
declare
  _def text; _oid oid;
  _alvo constant text := $a$     where p.status in ('scheduled', 'planned')
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '90 minutes'$a$;
  _novo constant text := $n$     where p.status in ('scheduled', 'planned')
       and p.scheduled_at is not null
       and p.scheduled_at < now() - interval '90 minutes'
       -- Rascunho SEM ARTE de mais de sete dias e rascunho abandonado, e
       -- nao post que faltou. Cobrar isso todo dia e ruido que esconde o
       -- alarme real. Com arte, alarma sempre: ali houve intencao.
       and (
         coalesce(p.file_id, po.primary_file_id) is not null
         or p.scheduled_at >= now() - interval '7 days'
       )$n$;
begin
  select p.oid into _oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'editorial_alerta_agendamento_atrasado';
  if _oid is null then
    raise exception 'patch_alvo_ausente: editorial_alerta_agendamento_atrasado';
  end if;
  _def := pg_get_functiondef(_oid);
  if position(_alvo in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o filtro do alarme mudou de forma; revise antes de aplicar';
  end if;
  execute replace(_def, _alvo, _novo);
end $patch$;
