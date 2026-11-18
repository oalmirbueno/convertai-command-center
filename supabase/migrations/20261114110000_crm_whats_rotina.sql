-- CRM da empresa, rodada 3 (14/11/2026): o que o robo de WhatsApp e a rotina dele precisam a mais.
-- Depende de 20261114100000_crm_meta_leads_e_whatsapp.sql (conversas, fila de envios, recebidas).
-- Tudo aqui e do servico (service_role): a tela nao chama nada disto. Reaplicavel.
--
--   crm_whats_contatos          janela de 24 h de quem nao e lead (o vendedor) e quem pediu para parar
--   crm_whats_entrada           mensagem que chegou: uma vez so, quem mandou (vendedor, lead) e guarda na conversa
--   crm_whats_contexto          o negocio, o vendedor e a conversa do robo, numa leitura
--   crm_whats_conversa_salvar   grava o estado da conversa
--   crm_whats_enfileirar        poe um envio na fila (chave unica; quem pediu para parar nao entra)
--   crm_whats_envios_pegar      reserva os envios da vez (como crm_conversoes_pegar)
--   crm_whats_envio_resultado   enviado, simulado, tentar de novo ou erro (como crm_conversao_resultado)
--   crm_whats_followups_pegar   conversas com o prazo de follow-up vencido
--   crm_whats_parar             o lead pediu para parar: nunca mais recebe
--   crm_whats_status_falhou     a Meta avisou depois que a entrega falhou

-- ---------------------------------------------------------------------------
-- 1. Contatos: janela do vendedor e pedidos de parar
-- ---------------------------------------------------------------------------
create table if not exists public.crm_whats_contatos (
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,15}$'),
  -- Ate quando este numero pode receber mensagem que nao e template (ele escreveu ha menos de 24 h).
  janela_ate timestamptz,
  -- Pediu para parar: nunca mais recebe nada do robo.
  parou_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (conta_id, telefone)
);

alter table public.crm_whats_contatos enable row level security;
revoke all on public.crm_whats_contatos from anon, authenticated;
grant all on public.crm_whats_contatos to service_role;

-- O mesmo numero escrito de jeitos diferentes (com ou sem 55, com ou sem o nono digito): DDD + 8 finais.
create or replace function public.crm_whats_nucleo(_telefone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when x.d ~ '^55[0-9]{10,11}$' then substr(x.d, 3, 2) || right(x.d, 8)
           when x.d ~ '^[0-9]{10,11}$' then left(x.d, 2) || right(x.d, 8)
           else x.d
         end
    from (select regexp_replace(coalesce(_telefone, ''), '\D', '', 'g') as d) x
$$;

-- ---------------------------------------------------------------------------
-- 2. Mensagem que chegou
-- ---------------------------------------------------------------------------
-- Registra uma vez so (a Meta repete), diz se quem mandou e vendedor e de qual conversa de lead e,
-- e guarda o texto na conversa do negocio. Vendedor que escreve abre a janela de 24 h dele.
create or replace function public.crm_whats_entrada(_conta uuid, _telefone text, _wa_message_id text, _texto text default null, _quando timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _tel text := regexp_replace(coalesce(_telefone, ''), '\D', '', 'g');
  _id text := left(coalesce(_wa_message_id, ''), 200);
  _nucleo text;
  _vend record;
  _lead uuid;
  _agora timestamptz := least(coalesce(_quando, now()), now());
begin
  if _conta is null or _tel !~ '^[0-9]{10,15}$' or _id = '' then
    return jsonb_build_object('nova', false);
  end if;
  insert into public.crm_whats_recebidas (conta_id, wa_message_id) values (_conta, _id) on conflict do nothing;
  if not found then
    return jsonb_build_object('nova', false);
  end if;
  _nucleo := public.crm_whats_nucleo(_tel);

  select m.user_id, m.nome into _vend
    from public.crm_vendedores v join public.produto_membros m on m.id = v.membro_id
   where v.conta_id = _conta and m.estado = 'ativo' and v.whatsapp is not null and public.crm_whats_nucleo(v.whatsapp) = _nucleo
   limit 1;
  if _vend.user_id is not null then
    insert into public.crm_whats_contatos (conta_id, telefone, janela_ate) values (_conta, _tel, _agora + interval '24 hours')
    on conflict (conta_id, telefone) do update set janela_ate = excluded.janela_ate, atualizado_em = now();
  end if;

  select c.lead_id into _lead
    from public.crm_whats_conversas c join public.crm_leads l on l.id = c.lead_id
   where c.conta_id = _conta and public.crm_whats_nucleo(c.telefone) = _nucleo and l.archived_at is null
   order by (c.etapa <> 'encerrado') desc, c.atualizado_em desc
   limit 1;
  if _lead is not null and nullif(btrim(coalesce(_texto, '')), '') is not null then
    insert into public.crm_lead_messages (conta_id, lead_id, direcao, canal, texto, enviada_em, id_externo)
    select _conta, _lead, 'entrada', 'whatsapp', left(btrim(_texto), 8000), _agora, _id
     where not exists (select 1 from public.crm_lead_messages x where x.lead_id = _lead and x.id_externo = _id);
  end if;

  return jsonb_build_object(
    'nova', true,
    'vendedor', case when _vend.user_id is not null then jsonb_build_object('user_id', _vend.user_id, 'nome', _vend.nome) end,
    'lead_id', _lead,
    'parou', exists (select 1 from public.crm_whats_contatos k
                      where k.conta_id = _conta and k.parou_em is not null and public.crm_whats_nucleo(k.telefone) = _nucleo));
end;
$$;

-- O tratamento falhou no meio: solta a mensagem para a Meta poder entregar de novo.
create or replace function public.crm_whats_entrada_desfazer(_conta uuid, _wa_message_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.crm_whats_recebidas where conta_id = _conta and wa_message_id = left(coalesce(_wa_message_id, ''), 200)
$$;

-- ---------------------------------------------------------------------------
-- 3. A conversa do robo: ler tudo de uma vez e gravar o estado
-- ---------------------------------------------------------------------------
create or replace function public.crm_whats_contexto(_lead uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lead', jsonb_build_object(
      'id', l.id, 'conta_id', l.conta_id, 'nome', l.name,
      'telefone', nullif(regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g'), ''),
      'nota', l.nota, 'faixa', l.faixa, 'etapa', l.stage, 'owner_id', l.owner_id,
      'na_fila', l.fila_desde is not null, 'nutricao', l.nutricao,
      'valor_mensal', l.monthly_value, 'valor_avulso', l.one_off_value,
      'campanha', l.origem_clique ->> 'utm_campaign', 'formulario', l.origem_clique ->> 'formulario',
      'arquivado', l.archived_at is not null),
    'vendedor', (
      select jsonb_build_object('user_id', m.user_id, 'nome', m.nome, 'whatsapp', v.whatsapp,
               'na_janela', v.whatsapp is not null and exists (
                 select 1 from public.crm_whats_contatos k
                  where k.conta_id = l.conta_id and k.janela_ate > now()
                    and public.crm_whats_nucleo(k.telefone) = public.crm_whats_nucleo(v.whatsapp)))
        from public.produto_membros m left join public.crm_vendedores v on v.membro_id = m.id
       where m.conta_id = l.conta_id and m.user_id = l.owner_id and m.estado = 'ativo'
       limit 1),
    'conversa', (select to_jsonb(c) from public.crm_whats_conversas c where c.lead_id = l.id),
    'parou', exists (select 1 from public.crm_whats_contatos k
                      where k.conta_id = l.conta_id and k.parou_em is not null
                        and public.crm_whats_nucleo(k.telefone) = public.crm_whats_nucleo(l.whatsapp)))
    from public.crm_leads l
   where l.id = _lead
$$;

create or replace function public.crm_whats_conversa_salvar(_lead uuid, _telefone text, _estado jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid;
  _tel text := regexp_replace(coalesce(_telefone, ''), '\D', '', 'g');
  _e jsonb := case when jsonb_typeof(_estado) = 'object' then _estado else '{}'::jsonb end;
  _etapa text := case when _e ->> 'etapa' in ('inicio', 'perguntando', 'qualificado', 'passado', 'nutricao', 'encerrado') then _e ->> 'etapa' else 'inicio' end;
  _respostas jsonb := case when jsonb_typeof(_e -> 'respostas') = 'object' and pg_column_size(_e -> 'respostas') <= 3900 then _e -> 'respostas' end;
begin
  select l.conta_id into _conta from public.crm_leads l where l.id = _lead;
  if _conta is null or _tel !~ '^[0-9]{10,15}$' then
    raise exception 'negócio ou telefone inválidos' using errcode = 'P0001';
  end if;
  insert into public.crm_whats_conversas as c (lead_id, conta_id, telefone, etapa, pergunta, respostas, janela_ate, ultima_do_lead_em,
                                                followups, proximo_followup_em, vendedor_avisado_em)
  values (_lead, _conta, _tel, _etapa, nullif(left(_e ->> 'pergunta', 60), ''), coalesce(_respostas, '{}'::jsonb),
          nullif(_e ->> 'janela_ate', '')::timestamptz, nullif(_e ->> 'ultima_do_lead_em', '')::timestamptz,
          least(greatest(coalesce(nullif(_e ->> 'followups', '')::integer, 0), 0), 10),
          nullif(_e ->> 'proximo_followup_em', '')::timestamptz, nullif(_e ->> 'vendedor_avisado_em', '')::timestamptz)
  on conflict (lead_id) do update set
    telefone = excluded.telefone, etapa = excluded.etapa, pergunta = excluded.pergunta,
    respostas = case when _respostas is null then c.respostas else excluded.respostas end,
    janela_ate = excluded.janela_ate, ultima_do_lead_em = excluded.ultima_do_lead_em, followups = excluded.followups,
    proximo_followup_em = excluded.proximo_followup_em,
    vendedor_avisado_em = coalesce(excluded.vendedor_avisado_em, c.vendedor_avisado_em),
    atualizado_em = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A fila de envios
-- ---------------------------------------------------------------------------
-- Poe na fila. A mesma chave nao entra duas vezes; lead que pediu para parar nao recebe.
create or replace function public.crm_whats_enfileirar(_conta uuid, _lead uuid, _para text, _destino text, _corpo jsonb, _chave text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _tel text := regexp_replace(coalesce(_para, ''), '\D', '', 'g');
  _id uuid;
begin
  if _conta is null or _tel !~ '^[0-9]{10,15}$' or _destino not in ('lead', 'vendedor')
     or jsonb_typeof(_corpo) <> 'object' or coalesce(_chave, '') = '' or length(_chave) > 200 then
    raise exception 'envio inválido' using errcode = 'P0001';
  end if;
  if _destino = 'lead' and exists (
       select 1 from public.crm_whats_contatos k
        where k.conta_id = _conta and k.parou_em is not null and public.crm_whats_nucleo(k.telefone) = public.crm_whats_nucleo(_tel)) then
    return jsonb_build_object('novo', false, 'bloqueado', true);
  end if;
  insert into public.crm_whats_envios (conta_id, lead_id, para, destino, corpo, chave)
  values (_conta, _lead, _tel, _destino, _corpo, _chave)
  on conflict (conta_id, chave) do nothing
  returning id into _id;
  return jsonb_build_object('novo', _id is not null, 'id', _id);
end;
$$;

-- Reserva os envios da vez (por 10 minutos: se a rodada cair, eles voltam sozinhos). `na_janela` diz se
-- quem recebe escreveu nas ultimas 24 h (fora disso so sai template).
create or replace function public.crm_whats_envios_pegar(_limite integer default 40, _conta uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _saida jsonb;
begin
  update public.crm_whats_envios set situacao = 'erro', erro = 'Passou de 3 dias sem conseguir enviar.'
   where situacao = 'pendente' and criado_em < now() - interval '3 days';

  with alvo as (
    select e.id from public.crm_whats_envios e
     where e.situacao = 'pendente' and e.proxima_em <= now() and (_conta is null or e.conta_id = _conta)
     order by e.criado_em, e.id
     limit least(greatest(coalesce(_limite, 40), 1), 200)
     for update skip locked
  ), pego as (
    update public.crm_whats_envios e set proxima_em = now() + interval '10 minutes'
      from alvo where e.id = alvo.id
    returning e.id, e.conta_id, e.lead_id, e.para, e.destino, e.corpo, e.chave, e.tentativas, e.criado_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'conta_id', p.conta_id, 'lead_id', p.lead_id, 'para', p.para, 'destino', p.destino,
           'corpo', p.corpo, 'chave', p.chave, 'tentativas', p.tentativas,
           'na_janela', case when p.destino = 'lead'
             then exists (select 1 from public.crm_whats_conversas c where c.lead_id = p.lead_id and c.janela_ate > now())
             else exists (select 1 from public.crm_whats_contatos k
                           where k.conta_id = p.conta_id and k.janela_ate > now()
                             and public.crm_whats_nucleo(k.telefone) = public.crm_whats_nucleo(p.para)) end
         ) order by p.criado_em, p.id), '[]'::jsonb)
    into _saida
    from pego p;
  return _saida;
end;
$$;

-- Anota o resultado de um envio:
--   enviado   saiu pela Cloud API;        simulado  modo teste ou sem numero/token: nada saiu;
--   de_novo   falha passageira: volta para a fila com espera crescente (2, 6, 18 e 54 min) e vira erro na quinta;
--   erro      nao vai sair (token recusado, template inexistente, fora da janela).
-- O que foi (ou seria) dito ao lead entra na conversa do negocio.
create or replace function public.crm_whats_envio_resultado(_id uuid, _situacao text, _wa_message_id text default null, _erro text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.crm_whats_envios;
  _wa text := nullif(left(coalesce(_wa_message_id, ''), 200), '');
  _externo text;
  _motivo text := left(coalesce(nullif(btrim(_erro), ''), 'O WhatsApp não aceitou a mensagem.'), 300);
begin
  select * into _e from public.crm_whats_envios where id = _id for update;
  if _e.id is null or _e.situacao <> 'pendente' then
    return;
  end if;
  if _situacao in ('enviado', 'simulado') then
    update public.crm_whats_envios set situacao = _situacao, enviado_em = now(), erro = null, tentativas = tentativas + 1, wa_message_id = _wa
     where id = _id;
    _externo := coalesce(_wa, 'envio:' || _e.id::text);
    if _e.destino = 'lead' and _e.lead_id is not null then
      insert into public.crm_lead_messages (conta_id, lead_id, direcao, canal, texto, operador_slug, id_externo)
      select _e.conta_id, _e.lead_id, 'saida', 'whatsapp',
             left(case when _situacao = 'simulado' then '[Simulado, não saiu] ' else '' end
                  || coalesce(nullif(btrim(_e.corpo ->> '_texto'), ''), 'Mensagem do robô.'), 8000),
             'robo', _externo
       where not exists (select 1 from public.crm_lead_messages x where x.lead_id = _e.lead_id and x.id_externo = _externo);
    elsif _e.lead_id is not null and _e.chave like 'vend:%:aviso' then
      insert into public.crm_lead_events (conta_id, lead_id, kind, note)
      values (_e.conta_id, _e.lead_id, 'nota',
              case when _situacao = 'simulado' then 'Aviso ao vendedor pelo WhatsApp (simulado, não saiu).' else 'O vendedor foi avisado pelo WhatsApp.' end);
    end if;
    if _situacao = 'enviado' then
      update public.crm_integracoes set ultimo_erro = null where conta_id = _e.conta_id and ultimo_erro is not null;
    end if;
  elsif _situacao = 'de_novo' and _e.tentativas + 1 < 5 then
    update public.crm_whats_envios set tentativas = tentativas + 1, erro = _motivo,
           proxima_em = now() + make_interval(mins => (2 * power(3, _e.tentativas))::integer)
     where id = _id;
  else
    update public.crm_whats_envios set situacao = 'erro', tentativas = tentativas + 1, erro = _motivo where id = _id;
    update public.crm_integracoes set ultimo_erro = _motivo where conta_id = _e.conta_id;
  end if;
end;
$$;

-- A Meta avisou depois (status "failed") que a entrega nao aconteceu.
create or replace function public.crm_whats_status_falhou(_conta uuid, _wa_message_id text, _erro text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.crm_whats_envios
     set situacao = 'erro', erro = left(coalesce(nullif(btrim(_erro), ''), 'O WhatsApp não entregou a mensagem.'), 300)
   where conta_id = _conta and wa_message_id = left(coalesce(_wa_message_id, ''), 200) and situacao = 'enviado'
$$;

-- ---------------------------------------------------------------------------
-- 5. Follow-up e pedido de parar
-- ---------------------------------------------------------------------------
-- Conversas com o prazo vencido, de empresas com a integracao ligada. Reserva por 10 minutos e devolve
-- quando o prazo vencia (a maquina de estados confere por ele).
create or replace function public.crm_whats_followups_pegar(_limite integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _saida jsonb;
begin
  update public.crm_whats_conversas set proximo_followup_em = null
   where proximo_followup_em is not null and etapa not in ('inicio', 'perguntando');

  with alvo as (
    select c.lead_id, c.proximo_followup_em as vencia_em
      from public.crm_whats_conversas c
      join public.crm_integracoes i on i.conta_id = c.conta_id and i.ativo
     where c.proximo_followup_em <= now() and c.etapa in ('inicio', 'perguntando')
     order by c.proximo_followup_em
     limit least(greatest(coalesce(_limite, 50), 1), 200)
     for update of c skip locked
  ), pego as (
    update public.crm_whats_conversas c set proximo_followup_em = now() + interval '10 minutes'
      from alvo where c.lead_id = alvo.lead_id
    returning c.lead_id, c.conta_id, alvo.vencia_em
  )
  select coalesce(jsonb_agg(jsonb_build_object('lead_id', p.lead_id, 'conta_id', p.conta_id, 'vencia_em', p.vencia_em) order by p.vencia_em), '[]'::jsonb)
    into _saida
    from pego p;
  return _saida;
end;
$$;

-- O lead pediu para parar: o numero fica marcado para sempre, o que estava na fila para ele cai, a conversa
-- encerra e o negocio ganha a anotacao. `_confirmacao` e o corpo da ultima mensagem ("nao vamos mais mandar").
create or replace function public.crm_whats_parar(_conta uuid, _lead uuid, _telefone text, _confirmacao jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _tel text := regexp_replace(coalesce(_telefone, ''), '\D', '', 'g');
  _nucleo text;
  _ja boolean;
begin
  if _conta is null or _tel !~ '^[0-9]{10,15}$' then
    raise exception 'telefone inválido' using errcode = 'P0001';
  end if;
  _nucleo := public.crm_whats_nucleo(_tel);
  _ja := exists (select 1 from public.crm_whats_contatos k
                  where k.conta_id = _conta and k.parou_em is not null and public.crm_whats_nucleo(k.telefone) = _nucleo);
  insert into public.crm_whats_contatos (conta_id, telefone, parou_em) values (_conta, _tel, now())
  on conflict (conta_id, telefone) do update set parou_em = coalesce(public.crm_whats_contatos.parou_em, now()), atualizado_em = now();
  update public.crm_whats_envios set situacao = 'erro', erro = 'O lead pediu para parar.'
   where conta_id = _conta and destino = 'lead' and situacao = 'pendente' and public.crm_whats_nucleo(para) = _nucleo
     and chave not like 'lead:%:parou';
  update public.crm_whats_conversas set etapa = 'encerrado', pergunta = null, proximo_followup_em = null, atualizado_em = now()
   where conta_id = _conta and public.crm_whats_nucleo(telefone) = _nucleo and etapa <> 'encerrado';
  if _lead is not null and not _ja and exists (select 1 from public.crm_leads l where l.id = _lead and l.conta_id = _conta) then
    insert into public.crm_lead_events (conta_id, lead_id, kind, note)
    values (_conta, _lead, 'nota', 'Pediu para não receber mais mensagens pelo WhatsApp. O robô parou e não manda mais nada para este número.');
    if jsonb_typeof(_confirmacao) = 'object' then
      insert into public.crm_whats_envios (conta_id, lead_id, para, destino, corpo, chave)
      values (_conta, _lead, _tel, 'lead', _confirmacao, 'lead:' || _lead::text || ':parou')
      on conflict (conta_id, chave) do nothing;
    end if;
  end if;
end;
$$;

do $$
declare _f text;
begin
  foreach _f in array array[
    'crm_whats_entrada(uuid, text, text, text, timestamptz)', 'crm_whats_entrada_desfazer(uuid, text)',
    'crm_whats_contexto(uuid)', 'crm_whats_conversa_salvar(uuid, text, jsonb)',
    'crm_whats_enfileirar(uuid, uuid, text, text, jsonb, text)', 'crm_whats_envios_pegar(integer, uuid)',
    'crm_whats_envio_resultado(uuid, text, text, text)', 'crm_whats_status_falhou(uuid, text, text)',
    'crm_whats_followups_pegar(integer)', 'crm_whats_parar(uuid, uuid, text, jsonb)', 'crm_whats_nucleo(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', _f);
    execute format('grant execute on function public.%s to service_role', _f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Agendamento da rotina (so onde pg_cron e pg_net existem)
-- ---------------------------------------------------------------------------
-- A cada 2 minutos, e so quando ha o que fazer (envio esperando, follow-up vencido ou lead na fila de uma
-- empresa ligada), chama a funcao produto-meta-rotina com o x-cron-secret. Para desligar:
--   select cron.unschedule(jobid) from cron.job where jobname = 'crm-whats-rotina-2min';
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'crm-whats-rotina-2min';
    perform cron.schedule('crm-whats-rotina-2min', '*/2 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/produto-meta-rotina',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('limite', 40),
        timeout_milliseconds := 60000
      )
      where exists (select 1 from public.crm_whats_envios e where e.situacao = 'pendente' and e.proxima_em <= now())
         or exists (select 1 from public.crm_whats_conversas c where c.proximo_followup_em <= now())
         or exists (select 1 from public.crm_leads l join public.crm_integracoes i on i.conta_id = l.conta_id and i.ativo
                     where l.fila_desde is not null and l.owner_id is null and l.archived_at is null);
    $cron$);
  end if;
exception when others then
  raise notice 'crm whats rotina: agendamento nao criado (%).', sqlerrm;
end;
$$;
