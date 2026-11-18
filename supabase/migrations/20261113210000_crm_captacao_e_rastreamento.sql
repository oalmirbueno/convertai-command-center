-- CRM da empresa, captacao e rastreamento (13/11/2026).
--
-- 1. crm_formularios: o gestor cria um link de captacao (anuncio, bio, site). Quem preenche vira negocio
--    no funil, com a origem do clique guardada em crm_leads.origem_clique (utm_*, fbclid, gclid, pagina).
-- 2. crm_rastreamento: o Pixel da Meta da empresa e o token da API de Conversoes, guardado no Vault.
--    A tela nunca recebe o token de volta: so "tem token" e os 4 ultimos caracteres.
-- 3. crm_conversoes: fila do que volta para a Meta. Negocio que entrou por formulario gera Lead;
--    negocio ganho gera Purchase com o valor. Uma linha por negocio e evento (sem duplicar).
-- 4. crm_origens: relatorio por origem e campanha, com o que a pessoa pode ver.
--
-- Tudo e acrescimo e a migration pode rodar de novo. O formulario instantaneo da Meta (Lead Ads, o
-- lead preenchido dentro do Facebook) NAO entra aqui: exige app aprovado na Meta.

-- ---------------------------------------------------------------------------
-- 1. Formularios de captacao
-- ---------------------------------------------------------------------------
create table if not exists public.crm_formularios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null default public.crm_conta_atual() references public.produto_contas(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 80),
  -- O que vai no link publico. Aleatorio, gerado no banco, nunca muda.
  token text not null unique check (token ~ '^[0-9a-f]{24}$'),
  titulo text not null default '' check (length(titulo) <= 120),
  descricao text not null default '' check (length(descricao) <= 600),
  texto_botao text not null default 'Enviar' check (length(btrim(texto_botao)) between 1 and 40),
  agradecimento text not null default 'Recebemos o seu contato. Em breve falamos com você.' check (length(agradecimento) <= 400),
  -- Nome e sempre pedido. Os outros: "nao", "opcional" ou "obrigatorio".
  campos jsonb not null default '{"whatsapp":"obrigatorio","email":"opcional","empresa":"nao","mensagem":"nao"}'::jsonb
    check (jsonb_typeof(campos) = 'object' and pg_column_size(campos) <= 600),
  -- Ate 3 perguntas proprias: [{ "chave": "cidade", "rotulo": "Qual a sua cidade?", "obrigatoria": true }].
  -- A resposta cai em crm_leads.campos[chave].
  perguntas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(perguntas) = 'array' and jsonb_array_length(perguntas) <= 3 and pg_column_size(perguntas) <= 2000),
  etapa_entrada text not null default 'novo' check (etapa_entrada in ('novo', 'contato', 'diagnostico', 'proposta', 'negociacao')),
  -- Responsavel fixo (user_id de alguem ativo na empresa). Vazio: fica sem dono e as automacoes distribuem.
  responsavel_id uuid,
  ativo boolean not null default true,
  envios integer not null default 0 check (envios >= 0),
  ultimo_envio_em timestamptz,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists crm_formularios_da_conta on public.crm_formularios (conta_id, criado_em desc);

alter table public.crm_formularios enable row level security;
revoke all on public.crm_formularios from anon;
grant select, insert, update, delete on public.crm_formularios to authenticated;
grant all on public.crm_formularios to service_role;

drop policy if exists "crm formularios leitura" on public.crm_formularios;
create policy "crm formularios leitura" on public.crm_formularios
  for select to authenticated
  using (conta_id = (select public.crm_conta_atual()));

drop policy if exists "crm formularios do gestor" on public.crm_formularios;
create policy "crm formularios do gestor" on public.crm_formularios
  for all to authenticated
  using (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()))
  with check (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()));

-- Os campos pedidos, sempre com as quatro chaves e um dos tres valores.
create or replace function public.crm_formulario_campos(_c jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'whatsapp', case when _c ->> 'whatsapp' in ('nao', 'opcional', 'obrigatorio') then _c ->> 'whatsapp' else 'obrigatorio' end,
    'email', case when _c ->> 'email' in ('nao', 'opcional', 'obrigatorio') then _c ->> 'email' else 'opcional' end,
    'empresa', case when _c ->> 'empresa' in ('nao', 'opcional', 'obrigatorio') then _c ->> 'empresa' else 'nao' end,
    'mensagem', case when _c ->> 'mensagem' in ('nao', 'opcional', 'obrigatorio') then _c ->> 'mensagem' else 'nao' end
  )
$$;

-- As perguntas proprias: so as bem formadas, sem chave repetida, no maximo 3.
create or replace function public.crm_formulario_perguntas(_p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('chave', n.chave, 'rotulo', n.rotulo, 'obrigatoria', n.obrigatoria) order by n.ordem), '[]'::jsonb)
    from (
      select t.*, row_number() over (order by t.ordem) as posicao
        from (
          select distinct on (x.chave) x.chave, x.rotulo, x.obrigatoria, x.ordem
            from (
              select e.item ->> 'chave' as chave,
                     left(btrim(coalesce(e.item ->> 'rotulo', '')), 80) as rotulo,
                     coalesce(e.item ->> 'obrigatoria', 'false') = 'true' as obrigatoria,
                     e.ordem
                from jsonb_array_elements(case when jsonb_typeof(_p) = 'array' then _p else '[]'::jsonb end) with ordinality as e(item, ordem)
               where jsonb_typeof(e.item) = 'object'
            ) x
           where x.chave ~ '^[a-z][a-z0-9_]{1,39}$' and length(x.rotulo) >= 2
           order by x.chave, x.ordem
        ) t
    ) n
   where n.posicao <= 3
$$;

revoke all on function public.crm_formulario_campos(jsonb) from public, anon;
grant execute on function public.crm_formulario_campos(jsonb) to authenticated, service_role;
revoke all on function public.crm_formulario_perguntas(jsonb) from public, anon;
grant execute on function public.crm_formulario_perguntas(jsonb) to authenticated, service_role;

-- O que a tela nao decide: o token, a empresa, o contador de envios. E o limite de 20 por empresa.
create or replace function public.crm_formulario_guarda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _da_tela boolean := auth.uid() is not null and coalesce(current_setting('crm.captacao', true), '') <> '1';
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.crm_formularios f where f.conta_id = new.conta_id) >= 20 then
      raise exception 'O limite é de 20 formulários por empresa.' using errcode = 'P0001';
    end if;
    new.token := left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 24);
    if _da_tela then
      new.envios := 0;
      new.ultimo_envio_em := null;
    end if;
  else
    new.conta_id := old.conta_id;
    new.token := old.token;
    new.criado_em := old.criado_em;
    if _da_tela then
      new.envios := old.envios;
      new.ultimo_envio_em := old.ultimo_envio_em;
    end if;
    new.atualizado_em := now();
  end if;
  new.nome := btrim(new.nome);
  new.titulo := btrim(coalesce(new.titulo, ''));
  new.descricao := btrim(coalesce(new.descricao, ''));
  new.texto_botao := coalesce(nullif(btrim(coalesce(new.texto_botao, '')), ''), 'Enviar');
  new.agradecimento := btrim(coalesce(new.agradecimento, ''));
  new.campos := public.crm_formulario_campos(new.campos);
  new.perguntas := public.crm_formulario_perguntas(new.perguntas);
  if new.responsavel_id is not null and not exists (
    select 1 from public.produto_membros m
     where m.conta_id = new.conta_id and m.user_id = new.responsavel_id and m.estado = 'ativo'
  ) then
    raise exception 'O responsável precisa ser alguém ativo na empresa.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_formulario_guarda() from public, anon, authenticated;

drop trigger if exists crm_formulario_guarda_trg on public.crm_formularios;
create trigger crm_formulario_guarda_trg
  before insert or update on public.crm_formularios
  for each row execute function public.crm_formulario_guarda();

-- ---------------------------------------------------------------------------
-- 2. Rastreamento: Pixel da Meta e token da API de Conversoes (no Vault)
-- ---------------------------------------------------------------------------
create table if not exists public.crm_rastreamento (
  conta_id uuid primary key references public.produto_contas(id) on delete cascade,
  meta_pixel_id text check (meta_pixel_id is null or meta_pixel_id ~ '^[0-9]{5,25}$'),
  -- O token mora no Vault; aqui fica so o endereco dele e os 4 ultimos caracteres.
  meta_token_secret_id uuid,
  meta_token_final text check (meta_token_final is null or length(meta_token_final) <= 4),
  eventos text[] not null default array['Lead', 'Purchase']::text[] check (eventos <@ array['Lead', 'Purchase']::text[]),
  codigo_de_teste text check (codigo_de_teste is null or codigo_de_teste ~ '^[A-Za-z0-9_-]{1,40}$'),
  ultimo_envio_em timestamptz,
  ultimo_erro text check (ultimo_erro is null or length(ultimo_erro) <= 300),
  atualizado_por uuid,
  atualizado_em timestamptz not null default now()
);

alter table public.crm_rastreamento enable row level security;
-- Ninguem le a tabela pela tela: so pelas funcoes abaixo.
revoke all on public.crm_rastreamento from anon, authenticated;
grant all on public.crm_rastreamento to service_role;

-- Apagar a linha (ou a empresa) leva o segredo junto.
create or replace function public.crm_rastreamento_apaga_segredo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.meta_token_secret_id is not null then
    begin
      delete from vault.secrets where id = old.meta_token_secret_id;
    exception when others then
      raise warning 'crm rastreamento: segredo nao removido: %', sqlerrm;
    end;
  end if;
  return old;
end;
$$;

revoke all on function public.crm_rastreamento_apaga_segredo() from public, anon, authenticated;

drop trigger if exists crm_rastreamento_apaga_segredo_trg on public.crm_rastreamento;
create trigger crm_rastreamento_apaga_segredo_trg
  after delete on public.crm_rastreamento
  for each row execute function public.crm_rastreamento_apaga_segredo();

-- ---------------------------------------------------------------------------
-- 3. Fila de conversoes para a Meta
-- ---------------------------------------------------------------------------
create table if not exists public.crm_conversoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  evento text not null check (evento in ('Lead', 'Purchase')),
  valor numeric(14, 2) not null default 0 check (valor >= 0),
  -- Dados do clique no momento do evento (fbclid, pagina, utm_*) e, no Lead, o IP e o navegador de quem preencheu.
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) <= 6000),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'erro')),
  tentativas integer not null default 0,
  erro text check (erro is null or length(erro) <= 300),
  proxima_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  unique (lead_id, evento)
);

create index if not exists crm_conversoes_da_fila on public.crm_conversoes (proxima_em) where situacao = 'pendente';
create index if not exists crm_conversoes_da_conta on public.crm_conversoes (conta_id, criado_em desc);

alter table public.crm_conversoes enable row level security;
revoke all on public.crm_conversoes from anon, authenticated;
-- A tela le a fila sem a coluna "dados" (IP e navegador de quem preencheu ficam so com o envio).
grant select (id, conta_id, lead_id, evento, valor, situacao, tentativas, erro, criado_em, enviado_em) on public.crm_conversoes to authenticated;
grant all on public.crm_conversoes to service_role;

drop policy if exists "crm conversoes do gestor" on public.crm_conversoes;
create policy "crm conversoes do gestor" on public.crm_conversoes
  for select to authenticated
  using (conta_id = (select public.crm_conta_atual()) and (select public.crm_sou_gestor()));

-- O valor de um negocio, como no ranking: 12 meses de mensalidade mais a entrada.
create or replace function public.crm_valor_do_negocio(_mensal numeric, _entrada numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$ select round(coalesce(_mensal, 0) * 12 + coalesce(_entrada, 0), 2) $$;

revoke all on function public.crm_valor_do_negocio(numeric, numeric) from public, anon;
grant execute on function public.crm_valor_do_negocio(numeric, numeric) to authenticated, service_role;

-- Negocio que entrou por formulario gera Lead; negocio ganho gera Purchase. So quando a empresa tem
-- pixel e token. Falha aqui nunca impede a equipe de salvar o negocio.
create or replace function public.crm_conversoes_do_negocio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _r public.crm_rastreamento;
  _clique jsonb;
begin
  begin
    -- Negocio reaberto antes do envio: a venda que ainda nao foi para a Meta sai da fila.
    if tg_op = 'UPDATE' and old.stage = 'ganho' and new.stage <> 'ganho' then
      delete from public.crm_conversoes where lead_id = new.id and evento = 'Purchase' and situacao = 'pendente';
    end if;

    select * into _r from public.crm_rastreamento where conta_id = new.conta_id;
    if _r.conta_id is null or _r.meta_pixel_id is null or _r.meta_token_secret_id is null then
      return new;
    end if;
    _clique := case when jsonb_typeof(new.origem_clique) = 'object' then new.origem_clique else '{}'::jsonb end;

    if tg_op = 'INSERT' and _clique ? 'formulario_id' and new.archived_at is null and 'Lead' = any (_r.eventos) then
      insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
      values (new.conta_id, new.id, 'Lead', 0, _clique)
      on conflict (lead_id, evento) do nothing;
    end if;

    if new.stage = 'ganho' and (tg_op = 'INSERT' or old.stage is distinct from 'ganho') and 'Purchase' = any (_r.eventos) then
      insert into public.crm_conversoes (conta_id, lead_id, evento, valor, dados)
      values (new.conta_id, new.id, 'Purchase', public.crm_valor_do_negocio(new.monthly_value, new.one_off_value), _clique)
      on conflict (lead_id, evento) do nothing;
    end if;
  exception when others then
    raise warning 'crm conversoes: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.crm_conversoes_do_negocio() from public, anon, authenticated;

drop trigger if exists crm_conversoes_do_negocio_trg on public.crm_leads;
create trigger crm_conversoes_do_negocio_trg
  after insert or update of stage on public.crm_leads
  for each row execute function public.crm_conversoes_do_negocio();

-- ---------------------------------------------------------------------------
-- 4. Rastreamento: salvar, ler (sem o token) e a leitura do token so para o servico
-- ---------------------------------------------------------------------------
create or replace function public.crm_rastreamento_ler()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.crm_conta_atual();
  _r public.crm_rastreamento;
begin
  if _conta is null or not public.crm_sou_gestor() then
    return null;
  end if;
  select * into _r from public.crm_rastreamento where conta_id = _conta;
  return jsonb_build_object(
    'meta_pixel_id', _r.meta_pixel_id,
    'tem_token', _r.meta_token_secret_id is not null,
    'token_final', case when _r.meta_token_secret_id is not null then _r.meta_token_final end,
    'eventos', to_jsonb(coalesce(_r.eventos, array['Lead', 'Purchase']::text[])),
    'codigo_de_teste', _r.codigo_de_teste,
    'ultimo_envio_em', _r.ultimo_envio_em,
    'ultimo_erro', _r.ultimo_erro,
    'atualizado_em', _r.atualizado_em,
    'fila', (select jsonb_build_object(
               'pendentes', count(*) filter (where c.situacao = 'pendente'),
               'enviados', count(*) filter (where c.situacao = 'enviado'),
               'erros', count(*) filter (where c.situacao = 'erro'))
               from public.crm_conversoes c where c.conta_id = _conta)
  );
end;
$$;

-- _dados: { meta_pixel_id?, meta_token?, remover_token?, eventos?, codigo_de_teste? }. So muda o que veio.
create or replace function public.crm_rastreamento_salvar(_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.crm_conta_atual();
  _r public.crm_rastreamento;
  _pixel text;
  _token text;
  _codigo text;
  _eventos text[];
  _segredo uuid;
  _trocou boolean := false;
begin
  if _conta is null then
    raise exception 'O CRM da empresa não está liberado.' using errcode = '42501';
  end if;
  if not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa configura o rastreamento.' using errcode = '42501';
  end if;
  if _dados is null or jsonb_typeof(_dados) <> 'object' then
    raise exception 'Nada para salvar.' using errcode = 'P0001';
  end if;

  insert into public.crm_rastreamento (conta_id, atualizado_por) values (_conta, _eu) on conflict (conta_id) do nothing;
  select * into _r from public.crm_rastreamento where conta_id = _conta for update;

  _pixel := _r.meta_pixel_id;
  if _dados ? 'meta_pixel_id' then
    _pixel := nullif(regexp_replace(coalesce(_dados ->> 'meta_pixel_id', ''), '\s', '', 'g'), '');
    if _pixel is not null and _pixel !~ '^[0-9]{5,25}$' then
      raise exception 'O ID do Pixel tem só números. Copie de novo no Gerenciador de Eventos.' using errcode = 'P0001';
    end if;
  end if;

  _codigo := _r.codigo_de_teste;
  if _dados ? 'codigo_de_teste' then
    _codigo := nullif(btrim(coalesce(_dados ->> 'codigo_de_teste', '')), '');
    if _codigo is not null and _codigo !~ '^[A-Za-z0-9_-]{1,40}$' then
      raise exception 'O código de teste tem letras e números, como TEST12345.' using errcode = 'P0001';
    end if;
  end if;

  _eventos := _r.eventos;
  if _dados ? 'eventos' and jsonb_typeof(_dados -> 'eventos') = 'array' then
    select coalesce(array_agg(distinct e.v order by e.v), '{}'::text[]) into _eventos
      from jsonb_array_elements_text(_dados -> 'eventos') as e(v)
     where e.v in ('Lead', 'Purchase');
  end if;

  _segredo := _r.meta_token_secret_id;
  if coalesce(_dados ->> 'remover_token', 'false') = 'true' then
    if _segredo is not null then
      delete from vault.secrets where id = _segredo;
    end if;
    _segredo := null;
    _trocou := true;
  elsif nullif(btrim(coalesce(_dados ->> 'meta_token', '')), '') is not null then
    _token := btrim(_dados ->> 'meta_token');
    if _token !~ '^[A-Za-z0-9_.|-]+$' or length(_token) not between 20 and 600 then
      raise exception 'O token não parece válido. Gere de novo no Gerenciador de Eventos e cole inteiro.' using errcode = 'P0001';
    end if;
    if _segredo is not null then
      perform vault.update_secret(_segredo, _token, null, null, null);
    else
      select vault.create_secret(_token, 'crm-meta-conversoes-' || _conta::text || '-' || gen_random_uuid()::text,
                                 'Token da API de Conversões da Meta (CRM da empresa)', null) into _segredo;
    end if;
    _trocou := true;
  end if;

  update public.crm_rastreamento set
    meta_pixel_id = _pixel,
    meta_token_secret_id = _segredo,
    meta_token_final = case when _segredo is null then null when _token is not null then right(_token, 4) else meta_token_final end,
    eventos = _eventos,
    codigo_de_teste = _codigo,
    ultimo_erro = case when _trocou then null else ultimo_erro end,
    atualizado_por = _eu,
    atualizado_em = now()
  where conta_id = _conta;

  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _eu, 'rastreamento_salvo', jsonb_build_object('pixel', _pixel is not null, 'token', _segredo is not null, 'token_trocado', _trocou));
  return public.crm_rastreamento_ler();
end;
$$;

-- O unico caminho que devolve o token: a funcao de envio, com a chave de servico.
create or replace function public.crm_rastreamento_token(_conta uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('pixel', r.meta_pixel_id, 'token', s.decrypted_secret, 'codigo_de_teste', r.codigo_de_teste, 'eventos', to_jsonb(r.eventos))
    from public.crm_rastreamento r
    join vault.decrypted_secrets s on s.id = r.meta_token_secret_id
   where r.conta_id = _conta and r.meta_pixel_id is not null
$$;

revoke all on function public.crm_rastreamento_ler() from public, anon;
grant execute on function public.crm_rastreamento_ler() to authenticated;
revoke all on function public.crm_rastreamento_salvar(jsonb) from public, anon;
grant execute on function public.crm_rastreamento_salvar(jsonb) to authenticated;
revoke all on function public.crm_rastreamento_token(uuid) from public, anon, authenticated;
grant execute on function public.crm_rastreamento_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. A fila vista pelo servico de envio
-- ---------------------------------------------------------------------------
-- Pega os proximos eventos e reserva por 10 minutos (duas rodadas ao mesmo tempo nao enviam o mesmo).
-- A Meta recusa evento com mais de 7 dias: o que passou disso vira erro, sem tentar.
create or replace function public.crm_conversoes_pegar(_limite integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _saida jsonb;
begin
  update public.crm_conversoes set situacao = 'erro', erro = 'Passou de 7 dias sem conseguir enviar.'
   where situacao = 'pendente' and criado_em < now() - interval '6 days 20 hours';

  with alvo as (
    select c.id from public.crm_conversoes c
     where c.situacao = 'pendente' and c.proxima_em <= now()
     order by c.criado_em
     limit least(greatest(coalesce(_limite, 40), 1), 200)
     for update skip locked
  ), pego as (
    update public.crm_conversoes c set proxima_em = now() + interval '10 minutes'
      from alvo where c.id = alvo.id
    returning c.id, c.conta_id, c.lead_id, c.evento, c.valor, c.dados, c.tentativas, c.criado_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'conta_id', p.conta_id, 'lead_id', p.lead_id, 'evento', p.evento, 'valor', p.valor,
           'dados', p.dados, 'tentativas', p.tentativas, 'criado_em', p.criado_em,
           'nome', l.name, 'email', l.email, 'whatsapp', l.whatsapp
         ) order by p.criado_em), '[]'::jsonb)
    into _saida
    from pego p
    left join public.crm_leads l on l.id = p.lead_id;
  return _saida;
end;
$$;

-- Anota o resultado de um envio. Falha passageira volta para a fila com espera crescente, ate 5 tentativas.
create or replace function public.crm_conversao_resultado(_id uuid, _ok boolean, _erro text default null, _definitivo boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _c public.crm_conversoes;
  _fim boolean;
begin
  select * into _c from public.crm_conversoes where id = _id for update;
  if _c.id is null or _c.situacao <> 'pendente' then
    return;
  end if;
  if _ok then
    update public.crm_conversoes set situacao = 'enviado', enviado_em = now(), erro = null, tentativas = tentativas + 1 where id = _id;
    update public.crm_rastreamento set ultimo_envio_em = now(), ultimo_erro = null where conta_id = _c.conta_id;
  else
    _fim := coalesce(_definitivo, false) or _c.tentativas + 1 >= 5;
    update public.crm_conversoes set
      tentativas = tentativas + 1,
      erro = left(coalesce(nullif(btrim(_erro), ''), 'A Meta não aceitou o evento.'), 300),
      situacao = case when _fim then 'erro' else 'pendente' end,
      proxima_em = now() + make_interval(mins => (5 * power(3, _c.tentativas))::integer)
    where id = _id;
    update public.crm_rastreamento set ultimo_erro = left(coalesce(nullif(btrim(_erro), ''), 'A Meta não aceitou o evento.'), 300) where conta_id = _c.conta_id;
  end if;
end;
$$;

-- O gestor manda tentar de novo o que deu erro (depois de corrigir o token, por exemplo).
create or replace function public.crm_conversoes_reenviar()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.crm_conta_atual();
  _n integer;
begin
  if _conta is null or not public.crm_sou_gestor() then
    raise exception 'Só o gerente ou quem administra a empresa reenvia eventos.' using errcode = '42501';
  end if;
  update public.crm_conversoes set situacao = 'pendente', tentativas = 0, erro = null, proxima_em = now()
   where conta_id = _conta and situacao = 'erro' and criado_em > now() - interval '6 days 20 hours';
  get diagnostics _n = row_count;
  return _n;
end;
$$;

revoke all on function public.crm_conversoes_pegar(integer) from public, anon, authenticated;
grant execute on function public.crm_conversoes_pegar(integer) to service_role;
revoke all on function public.crm_conversao_resultado(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.crm_conversao_resultado(uuid, boolean, text, boolean) to service_role;
revoke all on function public.crm_conversoes_reenviar() from public, anon;
grant execute on function public.crm_conversoes_reenviar() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. O formulario publico: o que a pagina le e o recebimento (so o servico chama)
-- ---------------------------------------------------------------------------
create or replace function public.crm_formulario_publico(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _f public.crm_formularios;
  _c public.produto_contas;
begin
  if _token is null or _token !~ '^[0-9a-f]{24}$' then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  select * into _f from public.crm_formularios where token = _token;
  if _f.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  select * into _c from public.produto_contas where id = _f.conta_id;
  if not _f.ativo or _c.id is null or not _c.crm_ativo or not public.produto_conta_liberada(_c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;
  return jsonb_build_object(
    'ok', true,
    'formulario', jsonb_build_object(
      'titulo', coalesce(nullif(_f.titulo, ''), _f.nome), 'descricao', _f.descricao, 'texto_botao', _f.texto_botao,
      'agradecimento', _f.agradecimento, 'campos', _f.campos, 'perguntas', _f.perguntas),
    'empresa', jsonb_build_object(
      'nome', coalesce(nullif(_c.aparencia ->> 'nome_curto', ''), _c.nome),
      'cor', _c.aparencia ->> 'cor',
      'logo', _c.aparencia ->> 'logo'),
    'pixel', (select r.meta_pixel_id from public.crm_rastreamento r where r.conta_id = _c.id)
  );
end;
$$;

-- Cria o negocio de quem preencheu. A empresa vem SO do token do formulario.
-- _dados: { nome, whatsapp?, email?, empresa?, mensagem?, respostas?: { chave: texto }, origem?: { utm_*, fbclid, gclid, pagina... } }
-- _tecnico: { ip?, navegador? } (vai so para a fila de conversoes).
create or replace function public.crm_captar(_token text, _dados jsonb, _tecnico jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _f public.crm_formularios;
  _c public.produto_contas;
  _d jsonb := case when jsonb_typeof(_dados) = 'object' then _dados else '{}'::jsonb end;
  _o jsonb;
  _r jsonb;
  _nome text;
  _whats text;
  _email text;
  _empresa text;
  _mensagem text;
  _campo text;
  _pergunta jsonb;
  _resposta text;
  _respostas jsonb := '{}'::jsonb;
  _notas text := '';
  _clique jsonb;
  _dono uuid;
  _ja uuid;
  _lead uuid;
  _evento uuid;
begin
  if _token is null or _token !~ '^[0-9a-f]{24}$' then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  select * into _f from public.crm_formularios where token = _token;
  if _f.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente');
  end if;
  select * into _c from public.produto_contas where id = _f.conta_id;
  if not _f.ativo or _c.id is null or not _c.crm_ativo or not public.produto_conta_liberada(_c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'desligado');
  end if;

  _o := case when jsonb_typeof(_d -> 'origem') = 'object' then _d -> 'origem' else '{}'::jsonb end;
  _r := case when jsonb_typeof(_d -> 'respostas') = 'object' then _d -> 'respostas' else '{}'::jsonb end;
  _nome := left(btrim(regexp_replace(coalesce(_d ->> 'nome', ''), '\s+', ' ', 'g')), 120);
  _whats := nullif(left(btrim(coalesce(_d ->> 'whatsapp', '')), 30), '');
  _email := nullif(lower(left(btrim(coalesce(_d ->> 'email', '')), 254)), '');
  _empresa := nullif(left(btrim(coalesce(_d ->> 'empresa', '')), 160), '');
  _mensagem := nullif(left(btrim(coalesce(_d ->> 'mensagem', '')), 2000), '');

  if length(_nome) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'nome');
  end if;
  if _email is not null and _email !~ '^[^@\s,()"]+@[^@\s,()"]+\.[^@\s,()"]+$' then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'email');
  end if;
  if _whats is not null and length(regexp_replace(_whats, '\D', '', 'g')) < 8 then
    return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', 'whatsapp');
  end if;
  -- Campo desligado no formulario nao entra, mesmo que venha no pedido.
  if _f.campos ->> 'whatsapp' = 'nao' then _whats := null; end if;
  if _f.campos ->> 'email' = 'nao' then _email := null; end if;
  if _f.campos ->> 'empresa' = 'nao' then _empresa := null; end if;
  if _f.campos ->> 'mensagem' = 'nao' then _mensagem := null; end if;
  foreach _campo in array array['whatsapp', 'email', 'empresa', 'mensagem'] loop
    if _f.campos ->> _campo = 'obrigatorio' and (case _campo when 'whatsapp' then _whats when 'email' then _email when 'empresa' then _empresa else _mensagem end) is null then
      return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', _campo);
    end if;
  end loop;

  if _mensagem is not null then
    _notas := 'Mensagem: ' || _mensagem;
  end if;
  for _pergunta in select * from jsonb_array_elements(_f.perguntas) loop
    _resposta := nullif(left(btrim(coalesce(_r ->> (_pergunta ->> 'chave'), '')), 300), '');
    if _resposta is null and coalesce(_pergunta ->> 'obrigatoria', 'false') = 'true' then
      return jsonb_build_object('ok', false, 'motivo', 'invalido', 'campo', _pergunta ->> 'chave');
    end if;
    if _resposta is not null then
      _respostas := _respostas || jsonb_build_object(_pergunta ->> 'chave', _resposta);
      _notas := _notas || case when _notas <> '' then E'\n' else '' end || (_pergunta ->> 'rotulo') || ' ' || _resposta;
    end if;
  end loop;

  perform set_config('crm.captacao', '1', true);
  update public.crm_formularios set envios = envios + 1, ultimo_envio_em = now() where id = _f.id;
  perform set_config('crm.captacao', '', true);

  -- A mesma pessoa (e-mail ou WhatsApp) com negocio aberto nao vira outro negocio: a historia ganha uma nota.
  select l.id into _ja from public.crm_leads l
   where l.conta_id = _f.conta_id and l.archived_at is null and l.stage not in ('ganho', 'perdido')
     and ((_email is not null and lower(btrim(coalesce(l.email, ''))) = _email)
          or (_whats is not null and regexp_replace(coalesce(l.whatsapp, ''), '\D', '', 'g') = regexp_replace(_whats, '\D', '', 'g')))
   order by l.created_at desc limit 1;
  if _ja is not null then
    insert into public.crm_lead_events (conta_id, lead_id, kind, note)
    values (_f.conta_id, _ja, 'nota', left('Preencheu de novo o formulário "' || _f.nome || '".' || case when _notas <> '' then E'\n' || _notas else '' end, 2000));
    return jsonb_build_object('ok', true, 'repetido', true, 'lead_id', _ja, 'evento_id', null);
  end if;

  _clique := jsonb_strip_nulls(jsonb_build_object(
    'formulario_id', _f.id::text,
    'formulario', _f.nome,
    'utm_source', nullif(left(btrim(coalesce(_o ->> 'utm_source', '')), 150), ''),
    'utm_medium', nullif(left(btrim(coalesce(_o ->> 'utm_medium', '')), 150), ''),
    'utm_campaign', nullif(left(btrim(coalesce(_o ->> 'utm_campaign', '')), 150), ''),
    'utm_content', nullif(left(btrim(coalesce(_o ->> 'utm_content', '')), 150), ''),
    'utm_term', nullif(left(btrim(coalesce(_o ->> 'utm_term', '')), 150), ''),
    'fbclid', case when _o ->> 'fbclid' ~ '^[A-Za-z0-9_.-]+$' and length(_o ->> 'fbclid') between 8 and 500 then _o ->> 'fbclid' end,
    'gclid', case when _o ->> 'gclid' ~ '^[A-Za-z0-9_.-]{8,200}$' then _o ->> 'gclid' end,
    'ad_id', case when _o ->> 'ad_id' ~ '^[0-9]{5,25}$' then _o ->> 'ad_id' end,
    'adset_id', case when _o ->> 'adset_id' ~ '^[0-9]{5,25}$' then _o ->> 'adset_id' end,
    'campaign_id', case when _o ->> 'campaign_id' ~ '^[0-9]{5,25}$' then _o ->> 'campaign_id' end,
    'fbp', case when _o ->> 'fbp' ~ '^fb\.[0-9]\.[0-9]{5,20}\.[0-9]{1,30}$' then _o ->> 'fbp' end,
    'clicado_em', case when _o ->> 'clicado_em' ~ '^[0-9]{10,14}$' then _o ->> 'clicado_em' end,
    'pagina', case when _o ->> 'pagina' ~ '^https?://' then left(_o ->> 'pagina', 300) end,
    'referencia', case when _o ->> 'referencia' ~ '^https?://' then left(_o ->> 'referencia', 200) end
  ));

  select m.user_id into _dono from public.produto_membros m
   where m.conta_id = _f.conta_id and m.user_id = _f.responsavel_id and m.estado = 'ativo';

  insert into public.crm_leads (conta_id, name, company, email, whatsapp, origin, stage, owner_id, notes, campos, origem_clique)
  values (_f.conta_id, _nome, _empresa, _email, _whats, 'site', _f.etapa_entrada, _dono, nullif(_notas, ''), _respostas, _clique)
  returning id into _lead;

  insert into public.crm_lead_events (conta_id, lead_id, kind, note)
  values (_f.conta_id, _lead, 'nota', left('Entrou pelo formulário "' || _f.nome || '".', 600));

  -- O IP e o navegador de quem preencheu vao so para a fila (a Meta usa para casar o evento com o clique).
  update public.crm_conversoes set dados = dados || jsonb_strip_nulls(jsonb_build_object(
      'ip', case when _tecnico ->> 'ip' ~ '^[0-9A-Fa-f:.]{3,45}$' then _tecnico ->> 'ip' end,
      'navegador', nullif(left(coalesce(_tecnico ->> 'navegador', ''), 300), '')))
   where lead_id = _lead and evento = 'Lead'
  returning id into _evento;

  return jsonb_build_object('ok', true, 'repetido', false, 'lead_id', _lead, 'evento_id', _evento);
end;
$$;

revoke all on function public.crm_formulario_publico(text) from public, anon, authenticated;
grant execute on function public.crm_formulario_publico(text) to service_role;
revoke all on function public.crm_captar(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.crm_captar(text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Relatorio: de onde vem os negocios e as vendas
-- ---------------------------------------------------------------------------
-- Negocios CRIADOS no periodo, por origem e campanha: quantos, quantos viraram venda e quanto valem.
-- Roda com a permissao de quem chama (security invoker): as regras de linha do CRM valem aqui, entao
-- o vendedor so conta o que ele pode ver. A origem e o utm_source do link; sem link, a origem do cadastro.
create or replace function public.crm_origens(_de date default null, _ate date default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with periodo as (
    select least(d.de, d.ate) as de, greatest(d.de, d.ate) as ate
      from (select coalesce(_de, (now() at time zone 'America/Sao_Paulo')::date - 29) as de,
                   coalesce(_ate, (now() at time zone 'America/Sao_Paulo')::date) as ate) d
  ), base as (
    select lower(coalesce(
             nullif(btrim(l.origem_clique ->> 'utm_source'), ''),
             case when l.origem_clique ? 'fbclid' then 'meta' when l.origem_clique ? 'gclid' then 'google' end,
             nullif(btrim(l.origin), ''), 'manual')) as origem,
           coalesce(nullif(btrim(l.origem_clique ->> 'utm_campaign'), ''), '') as campanha,
           (l.origem_clique is not null and (l.origem_clique ? 'utm_source' or l.origem_clique ? 'fbclid' or l.origem_clique ? 'gclid')) as rastreado,
           l.stage,
           public.crm_valor_do_negocio(l.monthly_value, l.one_off_value) as valor
      from public.crm_leads l, periodo p
     where l.conta_id = public.crm_conta_atual()
       and l.archived_at is null
       and l.created_at >= (p.de::timestamp at time zone 'America/Sao_Paulo')
       and l.created_at < ((p.ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and p.ate - p.de <= 731
  )
  select coalesce(jsonb_agg(to_jsonb(g) order by g.negocios desc, g.valor_ganho desc, g.origem, g.campanha), '[]'::jsonb)
    from (
      select b.origem, b.campanha, bool_or(b.rastreado) as rastreado,
             count(*) as negocios,
             count(*) filter (where b.stage not in ('ganho', 'perdido')) as abertos,
             count(*) filter (where b.stage = 'ganho') as ganhos,
             count(*) filter (where b.stage = 'perdido') as perdidos,
             coalesce(sum(b.valor) filter (where b.stage = 'ganho'), 0) as valor_ganho
        from base b
       group by b.origem, b.campanha
       order by count(*) desc
       limit 300
    ) g
$$;

revoke all on function public.crm_origens(date, date) from public, anon;
grant execute on function public.crm_origens(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Agendamento do envio (so onde pg_cron e pg_net existem)
-- ---------------------------------------------------------------------------
-- A cada 2 minutos, e so quando ha evento esperando, chama a funcao produto-conversoes com o
-- x-cron-secret (o mesmo padrao das outras rotinas). Para desligar:
--   select cron.unschedule(jobid) from cron.job where jobname = 'crm-conversoes-meta-2min';
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'crm-conversoes-meta-2min';
    perform cron.schedule('crm-conversoes-meta-2min', '*/2 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/produto-conversoes',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('limite', 40),
        timeout_milliseconds := 60000
      )
      where exists (select 1 from public.crm_conversoes c where c.situacao = 'pendente' and c.proxima_em <= now());
    $cron$);
  end if;
exception when others then
  raise notice 'crm conversoes: agendamento nao criado (%).', sqlerrm;
end;
$$;
