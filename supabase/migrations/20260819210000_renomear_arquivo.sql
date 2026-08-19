-- Renomear arquivo: o rótulo, nunca o material.
--
-- A política de escrita de `files` chama can_write_file -> file_is_editable,
-- que exige arquivo INTOCADO: interno, sem aprovação pedida e sem revisão.
-- É a régua certa para editar conteúdo, e a errada para o nome. O efeito
-- prático era que todo arquivo já compartilhado ficava preso ao nome com que
-- subiu — em geral o do celular, "IMG_20260819.jpg" — e a lista inteira de
-- Arquivos parecia genérica sem jeito de arrumar.
--
-- O que a aprovação protege é o CONTEÚDO: caminho no storage, versão, decisão
-- registrada. Nada disso muda ao trocar o nome exibido. Por isso a permissão
-- de renomear mora nesta função separada, com régua própria, em vez de
-- afrouxar file_is_editable — que liberaria junto visibilidade, aprovação e
-- substituição de material.
--
-- Papéis e acesso ao cliente são os MESMOS de can_write_file. A única
-- diferença é a cláusula final: aqui basta a peça não estar travada.

create or replace function public.rename_file(_file_id uuid, _new_name text)
returns public.files
language plpgsql
security definer
set search_path to ''
as $$
declare
  _row public.files;
  _limpo text := btrim(_new_name);
begin
  if _limpo = '' or length(_limpo) > 200 then
    raise exception 'Nome invalido';
  end if;

  select * into _row from public.files where id = _file_id;
  if not found then raise exception 'Arquivo nao encontrado'; end if;

  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  ) then raise exception 'Sem permissao para renomear'; end if;

  if not public.can_access_client(_row.client_id) then
    raise exception 'Sem acesso a este cliente';
  end if;

  -- Peça travada é imutável de propósito, inclusive no nome.
  if _row.locked_at is not null then raise exception 'Arquivo travado'; end if;

  update public.files
     set file_name = _limpo, updated_at = now()
   where id = _file_id
  returning * into _row;
  return _row;
end $$;

-- Sem anon: a função já falharia por falta de auth.uid(), mas deixar a porta
-- aberta é convite para alguém confiar nela sem ler.
revoke all on function public.rename_file(uuid, text) from public;
revoke execute on function public.rename_file(uuid, text) from anon;
grant execute on function public.rename_file(uuid, text) to authenticated;
