-- ═══════════════════════════════════════════════════════════════════════
-- PRESTACAO DE CONTAS: o agente age sozinho, e voce nao se perde.
--
-- O dono liberou: o que nao precisa de aprovacao, o agente faz. E poe uma
-- condicao junto, que e a parte importante:
--
--   "so que tem que me dizer o que foi feito, COMO, e COMO EU ACESSO e
--    documento, senao fico perdido"
--
-- Essa condicao nao e detalhe de interface: e o que torna a autonomia
-- sustentavel. Trabalho que acontece e ninguem consegue achar depois nao
-- e trabalho entregue — e trabalho perdido com passos extras.
--
-- POR QUE UMA TABELA NOVA, e nao um campo a mais na trilha.
--
-- operator_audit_log ja registra tudo, mas registra em `evidence`, um
-- texto solto. Foi exatamente dali que saiu a tela ilegivel que o dono
-- reclamou hoje ("so fala parece por codigo"): quando o lugar e um campo
-- de texto livre, cada agente escreve de um jeito e ninguem consegue
-- perguntar "onde eu acesso isso?" de forma confiavel.
--
-- Campo separado e campo que pode ser EXIGIDO. `onde_acessar` obrigatorio
-- e a diferenca entre "fizemos o carrossel" e "o carrossel esta aqui".
--
-- A trilha continua sendo a verdade auditavel; esta tabela e a leitura do
-- dono. As duas convivem porque respondem perguntas diferentes: a trilha
-- responde "o que aconteceu no sistema", esta responde "o que foi feito
-- pra mim e onde esta".
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.operator_deliveries (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.internal_operators(id) on delete cascade,
  kanban_task_id uuid,
  task_link_id uuid,
  -- Nulo = acao autonoma: o agente fez porque nao precisava de aprovacao.
  -- Preenchido = cumpriu uma ordem que voce autorizou.
  approval_id uuid references public.operator_approvals(id) on delete set null,
  client_id uuid,

  -- As quatro perguntas do dono, cada uma no seu campo.
  o_que text not null,
  como text not null,
  onde_acessar text not null,
  onde_documentado text,

  run_key text,
  occurred_at timestamptz not null default now()
);

comment on table public.operator_deliveries is
  'O que cada agente fez, como, e ONDE ACESSAR. Existe separada da trilha '
  'porque campo separado e campo que pode ser exigido: onde_acessar '
  'obrigatorio e a diferenca entre "fizemos o carrossel" e "o carrossel '
  'esta aqui".';

comment on column public.operator_deliveries.approval_id is
  'Nulo = acao autonoma (nao precisou de aprovacao). Preenchido = cumpriu '
  'ordem autorizada. Distinguir os dois importa: e a diferenca entre o que '
  'o agente decidiu sozinho e o que voce mandou.';

create index if not exists operator_deliveries_recentes
  on public.operator_deliveries (occurred_at desc);
create index if not exists operator_deliveries_por_cliente
  on public.operator_deliveries (client_id, occurred_at desc);

alter table public.operator_deliveries enable row level security;

-- Os papeis reais deste banco sao admin, manager, design, traffic e client.
-- Nao existe 'staff' (a primeira versao disto falhou por inventar o papel).
-- O cliente NAO entra: esta e a leitura interna do dono e da equipe.
drop policy if exists "equipe le as entregas" on public.operator_deliveries;
create policy "equipe le as entregas" on public.operator_deliveries
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  );

-- Escrita so por funcao SECURITY DEFINER: sem porta lateral que escape da
-- exigencia do onde_acessar.
drop policy if exists "ninguem escreve direto" on public.operator_deliveries;
create policy "ninguem escreve direto" on public.operator_deliveries
  for all to authenticated using (false) with check (false);


-- ─── A funcao que RECUSA sem "onde acessar" ─────────────────────────────
--
-- E ela que faz a promessa valer. Um campo opcional viraria vazio na
-- terceira semana; obrigatorio no banco nao tem como ser esquecido.
create or replace function public.operator_registrar_feito(
  _operator_slug text,
  _o_que text,
  _como text,
  _onde_acessar text,
  _onde_documentado text default null,
  _kanban_task_id uuid default null,
  _approval_id uuid default null,
  _run_key text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  _op public.internal_operators%rowtype;
  _client uuid;
  _link uuid;
  _id uuid;
  _proj uuid;
begin
  select * into _op from public.internal_operators where slug = lower(trim(_operator_slug));
  if not found then raise exception 'operator_not_found: % nao existe', _operator_slug; end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta % e nao registra entrega', _op.slug, _op.status; end if;

  if coalesce(btrim(_o_que), '') = '' then
    raise exception 'sem_o_que: diga o que foi feito, em portugues, como quem conta a uma pessoa'; end if;
  if coalesce(btrim(_como), '') = '' then
    raise exception 'sem_como: diga COMO foi feito; sem isso ninguem consegue repetir nem conferir'; end if;

  -- A EXIGENCIA CENTRAL. Trabalho que ninguem consegue achar depois nao e
  -- trabalho entregue: e trabalho perdido com passos extras.
  if coalesce(btrim(_onde_acessar), '') = '' then
    raise exception 'sem_onde_acessar: trabalho que ninguem consegue achar depois nao e trabalho entregue. Diga o link, a rota do painel ou o caminho do arquivo.'; end if;

  -- URL assinada carrega credencial. Guardada aqui, ela sairia em relatorio,
  -- grupo e segundo cerebro, e nao teria como ser desfeita.
  if _onde_acessar ~* '(token|signature|x-amz|apikey|api_key|secret|sig)=' then
    _onde_acessar := split_part(_onde_acessar, '?', 1) || ' [query removida: continha credencial]';
  end if;

  if _kanban_task_id is not null then
    select pj.client_id, pj.id into _client, _proj from public.tasks t
      join public.projects pj on pj.id = t.project_id where t.id = _kanban_task_id;
    select l.id into _link from public.operator_task_links l
      where l.operator_id = _op.id and l.kanban_task_id = _kanban_task_id
      order by l.created_at desc limit 1;
  end if;

  insert into public.operator_deliveries
    (operator_id, kanban_task_id, task_link_id, approval_id, client_id,
     o_que, como, onde_acessar, onde_documentado, run_key)
  values (_op.id, _kanban_task_id, _link, _approval_id, _client,
          btrim(_o_que), btrim(_como), btrim(_onde_acessar),
          nullif(btrim(coalesce(_onde_documentado, '')), ''), _run_key)
  returning id into _id;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
  values ('mcp:' || _op.slug, _op.id, _link, _kanban_task_id,
          case when _approval_id is null
            then 'entrega autonoma registrada' else 'entrega de ordem registrada' end,
          btrim(_onde_acessar), _run_key);

  -- A SINCRONIZACAO, em uma escrita so.
  --
  -- Ciclo, Central e Dossie ja leem project_memory — e nenhum dos tres
  -- conhecia a camada de agentes. Em vez de ensinar cada tela a ler mais
  -- uma tabela (tres lugares para esquecer de atualizar depois), a entrega
  -- passa pela espinha que os tres ja consultam. Uma escrita, tres telas.
  --
  -- kind 'entrega' e source 'operador' sao os mesmos que o caminho antigo
  -- (done com evidencia) ja usava: historico velho e novo ficam na mesma
  -- prateleira em vez de virarem duas verdades.
  if _client is not null then
    insert into public.project_memory
      (client_id, project_id, kind, source, title, content, tags, metadata)
    values (
      _client, _proj, 'entrega', 'operador',
      btrim(_o_que),
      btrim(_o_que) || E'

Como: ' || btrim(_como)
        || E'
Onde acessar: ' || btrim(_onde_acessar)
        || coalesce(E'
Documentado em: ' || nullif(btrim(coalesce(_onde_documentado, '')), ''), '')
        || E'
Agente: ' || _op.display_name,
      array['operador', _op.slug, case when _approval_id is null then 'autonoma' else 'ordem' end],
      jsonb_build_object(
        'delivery_id', _id, 'operator_slug', _op.slug, 'run_key', _run_key,
        'onde_acessar', btrim(_onde_acessar), 'autonoma', (_approval_id is null),
        'kanban_task_id', _kanban_task_id,
        -- client_visible false: e leitura interna. Entrega vira conversa com
        -- o cliente por decisao de gente, nao por efeito colateral.
        'client_visible', false)
    );
  end if;

  return jsonb_build_object('ok', true, 'delivery_id', _id,
    'autonoma', (_approval_id is null), 'client_id', _client,
    'na_memoria_do_cliente', (_client is not null));
end;
$$;

grant execute on function public.operator_registrar_feito(text, text, text, text, text, uuid, uuid, text)
  to authenticated, service_role;
