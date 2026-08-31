-- ═══════════════════════════════════════════════════════════════════════
-- UM SO JEITO DE PAGAR, E UM JEITO DE DESFAZER.
--
-- O painel tinha DOIS botoes "Pagar" com modelos opostos:
--
--   Custos Fixos  -> expense_pagar: cria a saida real e ROLA o molde.
--   Fluxo de Caixa -> update status='paid' na propria linha.
--
-- O segundo e destrutivo num custo recorrente: marcar o MOLDE como pago
-- o congela naquele mes, e a projecao dos meses seguintes para de existir
-- — o custo fixo simplesmente some da previsao sem ninguem perceber. E as
-- duas telas passam a discordar sobre o mesmo custo.
--
-- Aqui o pagamento ganha vinculo com o molde, o que torna o ESTORNO
-- possivel: sem saber de qual molde a saida veio, desfazer um pagamento
-- deixaria o vencimento rolado para sempre.
--
-- Nao altera valores nem lancamentos existentes. Rollback: drop da coluna
-- e da funcao de estorno.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) O pagamento sabe de qual molde veio ─────────────────────────────
--
-- Aditiva e anulavel: as 18 saidas que ja existem continuam validas sem
-- molde — elas nasceram antes desta regra, e forcar um vinculo nelas seria
-- inventar historia.
alter table public.expenses
  add column if not exists parent_expense_id uuid references public.expenses(id) on delete set null;

create index if not exists expenses_parent_idx
  on public.expenses (parent_expense_id) where parent_expense_id is not null;

-- ─── 2) expense_pagar passa a gravar o vinculo ──────────────────────────
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

  -- Despesa pontual nao tem molde para rolar: paga no lugar, sem criar
  -- linha nova. Antes esta funcao recusava, e a tela do Fluxo precisava de
  -- um caminho paralelo — foi dai que nasceram os dois modelos.
  if _molde.recurrence not in ('monthly', 'yearly') then
    update public.expenses
      set status = 'paid',
          paid_date = coalesce(_pago_em, current_date),
          amount = coalesce(_valor, amount),
          updated_at = now()
      where id = _molde.id;
    return jsonb_build_object(
      'ok', true,
      'pontual', true,
      'pagamento_id', _molde.id,
      'pago_em', coalesce(_pago_em, current_date),
      'valor', coalesce(_valor, _molde.amount),
      'proximo_vencimento', null
    );
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
     supplier, payment_method, notes, brand, created_by, parent_expense_id)
  values
    (_molde.description, _molde.category, _quanto, _molde.due_date, _quando, 'paid', 'none',
     _molde.supplier, _molde.payment_method,
     trim(coalesce(_molde.notes || ' · ', '') || 'Pagamento do custo fixo recorrente'),
     _molde.brand, auth.uid(), _molde.id)
  returning * into _pago;

  update public.expenses
    set due_date = _proximo, status = 'pending', paid_date = null, updated_at = now()
    where id = _molde.id;

  return jsonb_build_object(
    'ok', true,
    'pontual', false,
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

-- ─── 3) Desfazer um pagamento ───────────────────────────────────────────
--
-- Reabrir sem estornar deixaria o molde com o vencimento ja rolado e uma
-- saida paga solta: o mes seguinte cobraria de novo e o mes pago ficaria
-- com uma despesa fantasma. Estornar apaga a saida E devolve o vencimento
-- ao mes que foi pago — o estado volta a ser exatamente o de antes.
create or replace function public.expense_estornar(_pagamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _pago public.expenses%rowtype;
  _molde public.expenses%rowtype;
begin
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
  ) then
    raise exception 'sem_permissao: apenas admin ou manager estornam pagamento';
  end if;

  select * into _pago from public.expenses where id = _pagamento_id;
  if not found then
    raise exception 'pagamento_nao_encontrado: % nao existe', _pagamento_id;
  end if;
  if _pago.status <> 'paid' then
    raise exception 'nao_esta_pago: esta linha nao e um pagamento';
  end if;

  -- Sem molde e uma despesa pontual (ou anterior a esta regra): reabrir
  -- basta, e nao ha vencimento para devolver.
  if _pago.parent_expense_id is null then
    update public.expenses
      set status = 'pending', paid_date = null, updated_at = now()
      where id = _pago.id;
    return jsonb_build_object('ok', true, 'reaberta', true, 'molde_devolvido', false);
  end if;

  select * into _molde from public.expenses where id = _pago.parent_expense_id;
  if found then
    -- O vencimento volta para a competencia que estava sendo paga.
    update public.expenses
      set due_date = _pago.due_date, status = 'pending', paid_date = null, updated_at = now()
      where id = _molde.id;
  end if;

  delete from public.expenses where id = _pago.id;

  return jsonb_build_object(
    'ok', true,
    'reaberta', false,
    'molde_devolvido', found,
    'molde_id', _pago.parent_expense_id,
    'vencimento_restaurado', _pago.due_date
  );
end;
$$;

revoke all on function public.expense_estornar(uuid) from anon;
