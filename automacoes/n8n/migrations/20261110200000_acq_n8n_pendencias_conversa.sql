-- ACQ n8n — fila de pendências das conversas dos grupos, para a agente Clio do Hermes (10/11/2026).
-- Cada pedido de cliente, promessa nossa e resposta que esperamos do cliente vira uma linha com chave estável.
-- A Clio recebe a fila pelo webhook do ACQ-10 e abre tarefa interna com origem_externa = 'grupo:<chave>'.
-- Quem dá baixa é o banco: a linha fecha quando existe tarefa do mesmo cliente citando a chave. Sem duplicar:
-- cada linha é entregue no máximo 2 vezes. Só o schema isolado acq_n8n; a leitura de tarefas é por função definer.

create table if not exists acq_n8n.pendencias_conversa (
  chave text primary key,
  client_id uuid not null,
  dia date not null,
  tipo text not null check (tipo in ('pedido_cliente', 'pendencia_agencia', 'pendencia_cliente')),
  texto text not null,
  veio_de_audio boolean not null default false,
  pode_ser_repeticao boolean not null default false,
  estado text not null default 'nova' check (estado in ('nova', 'tarefa', 'encerrada')),
  entregas integer not null default 0,
  entregue_em timestamptz,
  task_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pendencias_conversa_fila on acq_n8n.pendencias_conversa (estado, dia);

create or replace function acq_n8n.pendencia_chave(_client uuid, _dia date, _tipo text, _texto text)
returns text language sql immutable as $$
  select left(encode(sha256(convert_to(_client::text || '|' || _dia::text || '|' || _tipo || '|' ||
    lower(regexp_replace(btrim(_texto), '\s+', ' ', 'g')), 'UTF8')), 'hex'), 24);
$$;

-- Espelha os itens acionáveis do resumo do dia. Item que saiu do resumo e ainda não foi entregue some;
-- item novo num dia que já teve entrega é marcado como possível repetição (o resumo foi reescrito).
create or replace function acq_n8n.pendencias_sincronizar() returns trigger language plpgsql as $$
declare _ja boolean;
begin
  if new.estado <> 'ok' then return new; end if;
  select exists (select 1 from acq_n8n.pendencias_conversa p where p.client_id = new.client_id and p.dia = new.dia and p.entregas > 0) into _ja;
  insert into acq_n8n.pendencias_conversa (chave, client_id, dia, tipo, texto, veio_de_audio, pode_ser_repeticao)
  select acq_n8n.pendencia_chave(new.client_id, new.dia, i->>'tipo', i->>'texto'), new.client_id, new.dia, i->>'tipo', i->>'texto',
         coalesce((i->>'veio_de_audio')::boolean, false), _ja
    from jsonb_array_elements(coalesce(new.conteudo->'itens', '[]'::jsonb)) i
   where i->>'tipo' in ('pedido_cliente', 'pendencia_agencia', 'pendencia_cliente') and length(btrim(coalesce(i->>'texto', ''))) >= 8
  on conflict (chave) do nothing;
  delete from acq_n8n.pendencias_conversa p
   where p.client_id = new.client_id and p.dia = new.dia and p.estado = 'nova' and p.entregas = 0
     and p.chave not in (select acq_n8n.pendencia_chave(new.client_id, new.dia, i->>'tipo', i->>'texto')
                           from jsonb_array_elements(coalesce(new.conteudo->'itens', '[]'::jsonb)) i);
  return new;
end $$;

drop trigger if exists resumos_dia_pendencias on acq_n8n.resumos_dia;
create trigger resumos_dia_pendencias after insert or update of conteudo, estado on acq_n8n.resumos_dia
  for each row execute function acq_n8n.pendencias_sincronizar();

-- Fila da Clio. Primeiro dá baixa no que já tem tarefa (origem_externa ou descrição citando grupo:<chave>, no
-- mesmo cliente); depois devolve o que segue novo, agrupado por cliente, com o resumo do dia para contexto.
-- _espiar = true só olha (não conta entrega). Linha com mais de _dias dias ou já entregue _max vezes é encerrada.
create or replace function acq_n8n.pendencias_fila(_espiar boolean default false, _dias integer default 5, _max integer default 2)
returns jsonb language plpgsql security definer set search_path = acq_n8n, public, pg_temp as $$
declare _hoje date := (now() at time zone 'America/Sao_Paulo')::date; _saida jsonb; _baixadas integer := 0; _encerradas integer := 0;
begin
  with achadas as (
    select distinct on (p.chave) p.chave, t.id as task_id
      from acq_n8n.pendencias_conversa p
      join public.projects pr on pr.client_id = p.client_id
      join public.tasks t on t.project_id = pr.id and t.deleted_at is null
       and (t.origem_externa = 'grupo:' || p.chave or position('grupo:' || p.chave in coalesce(t.description, '')) > 0)
     where p.estado = 'nova'
  ), upd as (
    update acq_n8n.pendencias_conversa p set estado = 'tarefa', task_id = a.task_id, atualizado_em = now()
      from achadas a where a.chave = p.chave returning 1
  ) select count(*) into _baixadas from upd;

  with upd as (
    update acq_n8n.pendencias_conversa set estado = 'encerrada', atualizado_em = now()
     where estado = 'nova' and (dia < _hoje - _dias or entregas >= _max) returning 1
  ) select count(*) into _encerradas from upd;

  select jsonb_build_object(
    'gerado_em', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
    'hoje', _hoje, 'baixadas_agora', _baixadas, 'encerradas_agora', _encerradas,
    'total', (select count(*) from acq_n8n.pendencias_conversa where estado = 'nova'),
    'clientes', coalesce((
      select jsonb_agg(c order by c->>'cliente') from (
        select jsonb_build_object(
          'client_id', p.client_id,
          'cliente', (select btrim(split_part(g.rotulo, ' - ', 1)) from acq_n8n.grupos_cliente g where g.client_id = p.client_id limit 1),
          'resumos', (select coalesce(jsonb_agg(jsonb_build_object('dia', r.dia, 'texto', r.texto) order by r.dia desc), '[]'::jsonb)
                        from acq_n8n.resumos_dia r where r.client_id = p.client_id and r.estado = 'ok' and r.dia in (select distinct p2.dia from acq_n8n.pendencias_conversa p2 where p2.client_id = p.client_id and p2.estado = 'nova')),
          -- Projetos e tarefas abertas vão junto: a resposta do painel para "listar tarefas" é grande demais para a agente.
          'projetos', (select coalesce(jsonb_agg(jsonb_build_object('project_id', pr.id, 'nome', pr.name, 'status', pr.status, 'tipo', pr.project_type) order by pr.status, pr.name), '[]'::jsonb)
                         from public.projects pr where pr.client_id = p.client_id and pr.deleted_at is null and pr.status in ('active', 'planning')),
          'tarefas_abertas', (select coalesce(jsonb_agg(y.x), '[]'::jsonb) from (
                         select jsonb_build_object('titulo', left(t.title, 110), 'status', t.status, 'prazo', t.due_date, 'dono', split_part(coalesce(pf.full_name, 'sem dono'), ' ', 1), 'projeto', left(pr.name, 40)) as x
                           from public.tasks t join public.projects pr on pr.id = t.project_id left join public.profiles pf on pf.id = t.assigned_to
                          where pr.client_id = p.client_id and pr.deleted_at is null and t.deleted_at is null and t.status <> 'done'
                          order by t.updated_at desc limit 60) y),
          'itens', jsonb_agg(jsonb_build_object('chave', p.chave, 'origem_externa', 'grupo:' || p.chave, 'dia', p.dia, 'tipo', p.tipo, 'texto', p.texto,
                     'veio_de_audio', p.veio_de_audio, 'pode_ser_repeticao', p.pode_ser_repeticao or p.entregas > 0, 'entrega_numero', p.entregas + 1) order by p.dia, p.tipo, p.criado_em)
        ) as c
        from acq_n8n.pendencias_conversa p where p.estado = 'nova' group by p.client_id
      ) x), '[]'::jsonb)
  ) into _saida;

  if not _espiar then
    update acq_n8n.pendencias_conversa set entregas = entregas + 1, entregue_em = now(), atualizado_em = now() where estado = 'nova';
  end if;
  return _saida;
end $$;

-- Preenche a fila com os resumos que já existem.
update acq_n8n.resumos_dia set conteudo = conteudo where estado = 'ok';

revoke all on acq_n8n.pendencias_conversa from anon, authenticated;
grant select, insert, update, delete on acq_n8n.pendencias_conversa to acq_n8n_worker;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
