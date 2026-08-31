-- ═══════════════════════════════════════════════════════════════════════
-- A ALIQUOTA MUDA TODO MES, E PAGAR UM CUSTO FIXO E DOIS ATOS.
--
-- Duas coisas que o painel tratava como se fossem uma so:
--
-- 1) A aliquota era a constante DEFAULT_TAX_RATE = 6%, usada em oito
--    lugares. No Simples ela sobe conforme o RBT12: 6% em janeiro pode
--    ser 8% em setembro. Uma constante forca o passado a mentir junto
--    com o presente — remendar o numero hoje reescreveria a reserva de
--    todos os meses ja fechados.
--    Agora cada competencia guarda a SUA aliquota, e mes sem registro cai
--    no piso declarado, sem inventar.
--
-- 2) Pagar um custo fixo eram dois atos que precisam acontecer juntos:
--    registrar a saida REAL do mes e rolar o vencimento para o proximo.
--    Meio caminho deixaria o custo pago sumido do caixa ou cobrado duas
--    vezes. Vira uma funcao transacional.
--
-- Nao altera: valores, historico, lancamentos existentes, financeiro dos
-- clientes. Rollback: drop da tabela e da funcao.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) A aliquota de cada mes ──────────────────────────────────────────
create table if not exists public.financial_tax_rates (
  -- Sempre o dia 1: competencia e mes, e guardar dia 17 abriria a porta
  -- para duas linhas do mesmo mes brigando.
  competence date primary key,
  rate numeric not null check (rate >= 0 and rate < 1),
  note text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competencia_e_dia_primeiro check (extract(day from competence) = 1)
);

alter table public.financial_tax_rates enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='financial_tax_rates' and policyname='admin_manager_leem_aliquota'
  ) then
    create policy admin_manager_leem_aliquota on public.financial_tax_rates
      for select using (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'manager'::public.app_role)
      );
  end if;
  -- Escrever a aliquota e mexer em quanto dinheiro fica reservado para o
  -- governo. Manager le; so admin muda.
  if not exists (
    select 1 from pg_policies where schemaname='public'
      and tablename='financial_tax_rates' and policyname='admin_escreve_aliquota'
  ) then
    create policy admin_escreve_aliquota on public.financial_tax_rates
      for all using (public.has_role(auth.uid(), 'admin'::public.app_role))
      with check (public.has_role(auth.uid(), 'admin'::public.app_role));
  end if;
end $$;

-- ─── 2) Pagar um custo fixo: registrar a saida e rolar o vencimento ─────
--
-- A linha recorrente e um MOLDE: ela projeta o futuro no fluxo de caixa.
-- Pagar nao a transforma em pagamento — cria a saida real daquele mes
-- (recurrence 'none', para nao virar molde tambem) e empurra o molde para
-- a proxima competencia.
--
-- Sem esse cuidado o mesmo custo apareceria como pago E como previsto no
-- mesmo mes, inflando a despesa do periodo.
create or replace function public.expense_pagar(
  _expense_id uuid,
  _pago_em date default null,
  _valor numeric default null,
  _proximo_vencimento date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _molde public.expenses%rowtype;
  _quando date;
  _quanto numeric;
  _proximo date;
  _pago public.expenses%rowtype;
begin
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  ) then
    raise exception 'sem_permissao: apenas admin ou manager registram pagamento';
  end if;

  select * into _molde from public.expenses where id = _expense_id;
  if not found then
    raise exception 'despesa_nao_encontrada: % nao existe', _expense_id;
  end if;
  if _molde.recurrence not in ('monthly', 'yearly') then
    raise exception 'nao_e_recorrente: esta despesa nao e um custo fixo recorrente';
  end if;

  _quando := coalesce(_pago_em, current_date);
  _quanto := coalesce(_valor, _molde.amount);

  -- O proximo vencimento sai do vencimento ATUAL, nao da data de
  -- pagamento: pagar em atraso nao pode empurrar todos os meses seguintes.
  _proximo := coalesce(
    _proximo_vencimento,
    (_molde.due_date + case when _molde.recurrence = 'yearly'
      then interval '1 year' else interval '1 month' end)::date
  );

  insert into public.expenses
    (description, category, amount, due_date, paid_date, status, recurrence,
     supplier, payment_method, notes, brand, created_by)
  values
    (_molde.description, _molde.category, _quanto, _molde.due_date, _quando, 'paid', 'none',
     _molde.supplier, _molde.payment_method,
     trim(coalesce(_molde.notes || ' · ', '') || 'Pagamento do custo fixo recorrente'),
     _molde.brand, auth.uid())
  returning * into _pago;

  update public.expenses
    set due_date = _proximo, status = 'pending', paid_date = null, updated_at = now()
    where id = _molde.id;

  return jsonb_build_object(
    'ok', true,
    'pagamento_id', _pago.id,
    'pago_em', _quando,
    'valor', _quanto,
    'competencia_paga', _molde.due_date,
    'proximo_vencimento', _proximo,
    'molde_id', _molde.id
  );
end;
$$;

revoke all on function public.expense_pagar(uuid, date, numeric, date) from anon;
