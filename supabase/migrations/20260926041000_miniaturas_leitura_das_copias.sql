-- T2 (26/09/2026): leitura das cópias leves das imagens (sem a transformação do Storage).
--
-- O painel grava ao lado de cada imagem duas cópias: "<caminho>.mini.jpg" (640 px)
-- e "<caminho>.media.jpg" (2048 px, só quando o original passa disso). A equipe já
-- lê e grava essas cópias pelas regras por pasta que existem hoje. O CLIENTE lê o
-- bucket files/mcp-files e a ponte do workspace por LINHA de arquivo
-- (files.storage_path = name), então sem esta regra ele continua vendo o original
-- (funciona, só baixa mais). Esta regra só AMPLIA a leitura: quem pode ler o
-- original pode ler as cópias dele. Nenhuma escrita nova; idempotente.
--
-- Validar antes com begin; ... rollback; no SQL Editor (a função
-- storage_object_read_allowed e can_client_read_file precisam existir no banco).

drop policy if exists "files: copias leves leitura" on storage.objects;
create policy "files: copias leves leitura"
on storage.objects
for select to authenticated
using (
  storage.objects.bucket_id in ('files', 'mcp-files')
  and (
    right(storage.objects.name, 9) = '.mini.jpg'
    or right(storage.objects.name, 10) = '.media.jpg'
  )
  and public.storage_object_read_allowed(
    storage.objects.bucket_id,
    case
      when right(storage.objects.name, 9) = '.mini.jpg' then left(storage.objects.name, length(storage.objects.name) - 9)
      else left(storage.objects.name, length(storage.objects.name) - 10)
    end
  )
);

drop policy if exists "workspace: copias leves leitura do cliente" on storage.objects;
create policy "workspace: copias leves leitura do cliente"
on storage.objects
for select to authenticated
using (
  storage.objects.bucket_id = 'workspace'
  and (
    right(storage.objects.name, 9) = '.mini.jpg'
    or right(storage.objects.name, 10) = '.media.jpg'
  )
  and exists (
    select 1
    from public.files as f
    where f.storage_bucket = 'workspace'
      and f.storage_path = case
        when right(storage.objects.name, 9) = '.mini.jpg' then left(storage.objects.name, length(storage.objects.name) - 9)
        else left(storage.objects.name, length(storage.objects.name) - 10)
      end
      and public.can_client_read_file(f.id)
  )
);
