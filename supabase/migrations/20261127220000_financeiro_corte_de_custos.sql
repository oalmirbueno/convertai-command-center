-- 27/11/2026 (dono): "uma área de encerradas ou pausadas e poder reassinar, uma área de corte de custos".
-- Aditiva: três colunas novas em expenses e um gatilho. Nada existente muda de valor, exceto a marcação das
-- seis assinaturas encerradas em 27/11 (molde mensal que já gerou parcelas e virou recurrence 'none').
--
-- Encerrar continua sendo recurrence -> 'none' (como já fazem o Financeiro e o agente CFO); o gatilho só
-- registra QUANDO e QUAL era a recorrência, para a área de Corte de custos poder reassinar. Voltar a
-- recurrence para monthly/yearly limpa a marcação. Pró-labore não entra (reajuste encerra o antigo).
--
-- Rollback lógico: DROP TRIGGER expenses_marca_corte ON public.expenses; as colunas podem ficar (nulas não
-- mudam nenhuma leitura existente).

alter table public.expenses
  add column if not exists corte_estado text,
  add column if not exists corte_em timestamptz,
  add column if not exists corte_recorrencia text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_corte_estado_check') then
    alter table public.expenses add constraint expenses_corte_estado_check
      check (corte_estado is null or corte_estado in ('pausada', 'encerrada'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_corte_recorrencia_check') then
    alter table public.expenses add constraint expenses_corte_recorrencia_check
      check (corte_recorrencia is null or corte_recorrencia in ('monthly', 'yearly'));
  end if;
end $$;

create or replace function public.expenses_marca_corte()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Voltou a se repetir: reassinada, sai da área de corte.
  if new.recurrence in ('monthly', 'yearly') then
    new.corte_estado := null;
    new.corte_em := null;
    new.corte_recorrencia := null;
    return new;
  end if;
  -- Deixou de se repetir agora: guarda quando e qual era (pausada se quem mudou pediu; senão encerrada).
  if tg_op = 'UPDATE' and old.recurrence in ('monthly', 'yearly') and new.recurrence = 'none'
     and not (coalesce(new.category, '') = 'salarios'
              or (coalesce(new.description, '') || ' ' || coalesce(new.notes, '')) ~* 'pr[oó][[:space:]_-]?labore') then
    new.corte_estado := coalesce(new.corte_estado, 'encerrada');
    new.corte_em := coalesce(new.corte_em, now());
    new.corte_recorrencia := old.recurrence;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_marca_corte on public.expenses;
create trigger expenses_marca_corte
  before update of recurrence, corte_estado on public.expenses
  for each row execute function public.expenses_marca_corte();

-- As seis encerradas em 27/11 (antes do gatilho existir): molde que gerou parcelas e virou 'none' hoje.
update public.expenses e
   set corte_estado = 'encerrada', corte_em = e.updated_at, corte_recorrencia = 'monthly'
 where e.recurrence = 'none'
   and e.corte_estado is null
   and e.updated_at >= '2026-11-27 00:00:00-03'
   and exists (select 1 from public.expenses c where c.parent_expense_id = e.id)
   and coalesce(e.category, '') <> 'salarios';
