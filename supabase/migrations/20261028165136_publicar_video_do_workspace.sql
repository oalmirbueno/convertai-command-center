-- ═══════════════════════════════════════════════════════════════════════
-- VÍDEO DO WORKSPACE TAMBÉM VAI AO AR (28/10/2026).
--
-- O vídeo "A Chilli Beans começou numa feirinha" (Aceleriq) estava aprovado
-- e agendado e não saiu: o job falhou com "Nao foi possivel assinar os
-- arquivos da publicacao". O motor pedia a URL assinada SEMPRE no bucket
-- `files` (/storage/v1/object/sign/files), mas o vídeo entregue pela Mesa
-- (Workspace -> Arquivos) continua no bucket `workspace`. Carrossel do
-- Estúdio fica em `files` e por isso publicava.
--
-- Agora a assinatura vai ao bucket onde o arquivo da publicação está (o do
-- primeiro item da lista congelada; sem lista, o do arquivo principal).
-- Só essa linha do editorial_autopublish_tick muda; o resto da função fica
-- como está no banco.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function social_private.autopublish_storage_bucket(_publication_id uuid, _root_file_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select nullif(file_row.storage_bucket, '')
       from social_private.editorial_publication_assets as asset
       join public.files as file_row on file_row.id = asset.file_id
      where asset.publication_id = _publication_id
        and file_row.storage_path is not null
      order by asset.position
      limit 1),
    (select nullif(root_row.storage_bucket, '')
       from public.files as root_row
      where root_row.id = _root_file_id),
    'files'
  );
$$;

revoke all on function social_private.autopublish_storage_bucket(uuid, uuid) from public, anon, authenticated;

do $do$
declare
  _def text := pg_get_functiondef('public.editorial_autopublish_tick()'::regprocedure);
  _antes constant text := $s$url := _settings.storage_base_url || '/storage/v1/object/sign/files',$s$;
  _depois constant text := $s$url := _settings.storage_base_url || '/storage/v1/object/sign/' || social_private.autopublish_storage_bucket(_pub.id, _pub.file_id),$s$;
begin
  if position(_depois in _def) > 0 then
    return; -- já aplicada
  end if;
  if (length(_def) - length(replace(_def, _antes, ''))) / length(_antes) <> 1 then
    raise exception 'editorial_autopublish_tick mudou: a linha da assinatura não foi encontrada uma única vez';
  end if;
  execute replace(_def, _antes, _depois);
end;
$do$;
