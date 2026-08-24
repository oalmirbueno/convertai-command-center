-- Auditoria de referencias orfas: linhas que apontam para um cliente que
-- nao existe.
--
-- O caso que expos a falha: o agente gravou memoria para a Verzelo com um
-- client_id que nao e de nenhum profile. project_memory tem
-- `client_id uuid NOT NULL` e NENHUMA chave estrangeira, entao o insert
-- passou e virou registro orfao - o agente recebeu "gravado" e o dado nao
-- aparece em lugar nenhum do painel. O dossie, que valida, recusou; e a
-- divergencia entre os dois foi lida como defeito do dossie.
--
-- A auditoria nao pegou porque a verificacao de memoria procurava
-- `client_id IS NULL`, impossivel numa coluna NOT NULL: era uma
-- verificacao MORTA, que passava sempre. Esta funcao procura o que
-- realmente acontece - id preenchido apontando para ninguem.
--
-- Nao cria chave estrangeira em project_memory de proposito: a tabela ja
-- tem historico gravado, e uma FK retroativa falharia no meio de dados
-- antigos. A porta foi fechada na escrita (project-memory-services valida
-- antes de inserir) e o que ja passou aparece aqui para ser corrigido com
-- decisao humana.

create or replace function public.audit_referencias_orfas()
returns table (
  tabela text,
  id uuid,
  client_id_orfao uuid,
  criado_em timestamptz
)
language sql
security definer
set search_path = public
as $$
  -- Memoria apontando para cliente inexistente.
  select 'project_memory'::text, m.id, m.client_id, m.created_at
  from public.project_memory m
  where not exists (
    select 1 from public.profiles p where p.id = m.client_id
  )

  union all

  -- Dossie apontando para cliente inexistente. A tabela TEM chave
  -- estrangeira, entao aqui deve ser sempre vazio: a linha existir
  -- significaria corrupcao, e vale saber.
  select 'client_dossiers'::text, d.id, d.client_id, d.created_at
  from public.client_dossiers d
  where not exists (
    select 1 from public.profiles p where p.id = d.client_id
  )

  union all

  -- Projeto cujo dono nao existe mais.
  select 'projects'::text, pj.id, pj.client_id, pj.created_at
  from public.projects pj
  where pj.deleted_at is null
    and not exists (
      select 1 from public.profiles p where p.id = pj.client_id
    )

  order by 4 desc
  limit 500
$$;

revoke execute on function public.audit_referencias_orfas() from anon;
grant execute on function public.audit_referencias_orfas() to service_role;

comment on function public.audit_referencias_orfas() is
  'Linhas cujo client_id aponta para nenhum profile. project_memory nao tem FK, entao e onde isso acontece de verdade.';
