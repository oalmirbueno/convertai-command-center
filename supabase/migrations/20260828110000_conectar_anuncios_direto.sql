-- Conectar anuncios ganha porta propria, sem encostar no Instagram.
--
-- O RELATO: "vamos deixar a conexao direta aqui tambem para anuncios, sem
-- precisar mexer nos do Instagram que ja esta conectado e ja esta
-- publicado".
--
-- Ele esta certo, e minha solucao anterior era pior do que parecia: eu
-- tinha feito o token de anuncios ser colhido DE CARONA na conexao de
-- Instagram. Funciona, mas obriga a reconectar uma conta que ja funciona
-- so para pegar outra coisa. Mexer no que esta de pe para conseguir o que
-- ainda nao esta e um mau negocio: se a reconexao der errado, ele perde
-- as duas coisas em vez de nenhuma.
--
-- Agora sao duas portas independentes. A de anuncios tem sessao propria,
-- e nao reaproveita a sessao do social — que exige cliente e projeto,
-- coisas que um token de carteira inteira nao tem. Forcar um cliente
-- qualquer ali so para preencher o campo criaria um registro que diz uma
-- coisa e significa outra.
--
-- A carona continua existindo para quem conectar Instagram de qualquer
-- forma: quem ganha os dois de uma vez, ganha. Esta migration adiciona um
-- caminho, nao substitui nenhum.
--
-- Rodar de novo nao faz mal.

create table if not exists social_private.ads_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table social_private.ads_oauth_sessions enable row level security;

create index if not exists ads_oauth_sessions_limpeza_idx
  on social_private.ads_oauth_sessions (created_at)
  where consumed_at is null;

/**
 * Abre a sessao de conexao de anuncios.
 *
 * O `state` e o que impede alguem de forjar o retorno do login: ele sai
 * daqui, viaja ate a Meta e volta, e so vale se bater com o que foi
 * gravado. Aleatorio e de uso unico, por isso.
 */
create or replace function public.ads_oauth_create_session()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _state text;
  _id uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'somente administrador pode conectar anuncios';
  end if;

  -- Sessao velha e sessao esquecida: some depois de uma hora. Sem isso a
  -- tabela vira um deposito de estados que ninguem mais vai usar.
  delete from social_private.ads_oauth_sessions
   where consumed_at is null and created_at < now() - interval '1 hour';

  _state := encode(gen_random_bytes(32), 'hex');

  insert into social_private.ads_oauth_sessions (state, actor_id)
  values (_state, auth.uid())
  returning id into _id;

  return jsonb_build_object('oauth_session_id', _id, 'state', _state);
end;
$fn$;

revoke execute on function public.ads_oauth_create_session() from anon;
grant execute on function public.ads_oauth_create_session() to authenticated;

/**
 * Consome a sessao no retorno do login.
 *
 * De USO UNICO: marcar como consumida na propria consulta que a valida e
 * o que impede o mesmo retorno de ser reapresentado. Validar e marcar em
 * dois passos deixaria uma fresta entre um e outro.
 */
create or replace function public.ads_oauth_consume_session(_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  _linha social_private.ads_oauth_sessions%rowtype;
begin
  update social_private.ads_oauth_sessions
     set consumed_at = now()
   where state = _state
     and consumed_at is null
     and created_at > now() - interval '1 hour'
  returning * into _linha;

  if not found then
    raise exception 'sessao_invalida: a conexao expirou ou ja foi usada. Comece de novo.';
  end if;

  return jsonb_build_object('oauth_session_id', _linha.id, 'actor_id', _linha.actor_id);
end;
$fn$;

revoke execute on function public.ads_oauth_consume_session(text) from anon, authenticated;
grant execute on function public.ads_oauth_consume_session(text) to service_role;
