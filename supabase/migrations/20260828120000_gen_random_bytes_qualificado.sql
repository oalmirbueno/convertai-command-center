-- Conserto: gen_random_bytes precisa vir com o esquema na frente.
--
-- O SINTOMA: "Nao foi possivel iniciar a conexao de anuncios", ao clicar
-- em Conectar com a Meta.
--
-- A CAUSA, e e erro meu: `ads_oauth_create_session` foi escrita com
-- `set search_path = ''` — o jeito certo e seguro de escrever funcao
-- SECURITY DEFINER, porque impede que alguem crie uma funcao com nome
-- parecido num esquema qualquer e sequestre a chamada. So que, com o
-- caminho de busca vazio, TUDO precisa vir qualificado. E eu escrevi
-- `gen_random_bytes(32)` solto.
--
-- `gen_random_bytes` vem do pgcrypto, que neste banco vive no esquema
-- `extensions`. Sem o caminho de busca, ele nao e encontrado:
--
--   ERROR: function gen_random_bytes(integer) does not exist
--
-- Confirmei rodando uma funcao de teste com o mesmo search_path vazio
-- antes de escrever este conserto, e conferi tambem `gen_random_uuid` e
-- `encode`, que estao no pg_catalog e resolvem sem qualificacao — por isso
-- so esta chamada quebrou, e nenhuma das outras.
--
-- POR QUE PASSOU PELOS TESTES: a suite le o SQL como texto e confere as
-- regras de negocio (uso unico, expiracao, quem pode chamar). Nome de
-- funcao que so falha na hora de executar, com um search_path especifico,
-- nao aparece em leitura de texto. E o mesmo tipo de armadilha do
-- `public.clients`: plpgsql so descobre no primeiro uso.
--
-- Rodar de novo nao faz mal.

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

  -- QUALIFICADO: pgcrypto mora em `extensions`, e com search_path vazio
  -- nada e encontrado sem o esquema na frente.
  _state := encode(extensions.gen_random_bytes(32), 'hex');

  insert into social_private.ads_oauth_sessions (state, actor_id)
  values (_state, auth.uid())
  returning id into _id;

  return jsonb_build_object('oauth_session_id', _id, 'state', _state);
end;
$fn$;

revoke execute on function public.ads_oauth_create_session() from anon;
grant execute on function public.ads_oauth_create_session() to authenticated;
