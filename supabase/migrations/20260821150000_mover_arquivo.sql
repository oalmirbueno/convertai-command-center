-- Mover arquivo de pasta e de projeto: organizar a gaveta, nunca o conteúdo.
--
-- O relato: subiu o arquivo, quis colocá-lo no projeto certo ou trocar a
-- pasta — e o painel recusou, porque a política de escrita de `files` exige
-- arquivo INTOCADO (a mesma régua que prendia o renomear). Pasta e projeto
-- são organização, como o nome: mudá-los não altera o material, a versão nem
-- a decisão de aprovação.
--
-- Diferença deliberada em relação a rename_file: aqui até o arquivo TRAVADO
-- pode ser movido. O travamento protege a identidade da peça (o que o
-- cliente aprovou); a gaveta onde ela mora não faz parte dessa identidade.
--
-- A única trava real é de CONSISTÊNCIA: arquivo usado como arte de um
-- conteúdo editorial não pode ir para um projeto diferente do conteúdo —
-- os guardas editoriais recusariam cada salvar dali em diante, e o erro
-- apareceria longe da causa.

-- ── Guarda de files: travado continua imutável PARA A TELA; as funções
-- confiáveis (SECURITY DEFINER, como esta e rename_file) passam a poder
-- atualizar — cada uma com a própria régua, que é onde a governança já
-- mora de fato. APAGAR travado segue proibido para todos: o bloco de
-- DELETE não muda.
DO $patch$
DECLARE
  _fonte text;
  _alvo text;
  _sub text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fonte
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'files_secure_guard';

  -- A âncora inclui o trecho "IF NOT _trusted... AND (" com campos NEW,
  -- que só existe no ramo de UPDATE — o ramo de DELETE termina antes.
  _alvo := E'  IF COALESCE(_root_locked, false) THEN\n'
        || E'    RAISE EXCEPTION ''terminal file versions are immutable'';\n'
        || E'  END IF;\n'
        || E'  _root_editable :=\n'
        || E'    _root_visibility = ''internal''\n'
        || E'    AND _root_agency_status = ''not_requested''\n'
        || E'    AND _root_approval_status = ''none'';\n'
        || E'  IF NOT _trusted_approval_write\n'
        || E'    AND NOT COALESCE(_root_editable, false) THEN\n'
        || E'    RAISE EXCEPTION ''file versions under review or released are immutable'';\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  IF NOT _trusted_approval_write AND (';
  _sub  := E'  IF COALESCE(_root_locked, false)\n'
        || E'    AND NOT _trusted_approval_write THEN\n'
        || E'    RAISE EXCEPTION ''terminal file versions are immutable'';\n'
        || E'  END IF;\n'
        || E'  _root_editable :=\n'
        || E'    _root_visibility = ''internal''\n'
        || E'    AND _root_agency_status = ''not_requested''\n'
        || E'    AND _root_approval_status = ''none'';\n'
        || E'  IF NOT _trusted_approval_write\n'
        || E'    AND NOT COALESCE(_root_editable, false) THEN\n'
        || E'    RAISE EXCEPTION ''file versions under review or released are immutable'';\n'
        || E'  END IF;\n'
        || E'\n'
        || E'  IF NOT _trusted_approval_write AND (';
  IF (length(_fonte) - length(replace(_fonte, _alvo, ''))) / length(_alvo) <> 1 THEN
    RAISE EXCEPTION 'patch guard: alvo nao encontrado exatamente 1 vez';
  END IF;
  EXECUTE replace(_fonte, _alvo, _sub);
END
$patch$;

create or replace function public.move_file(
  _file_id uuid,
  _folder text default null,
  _project_id uuid default null
)
returns public.files
language plpgsql
security definer
set search_path to ''
as $$
declare
  _row public.files;
begin
  select * into _row from public.files where id = _file_id;
  if not found then raise exception 'Arquivo nao encontrado'; end if;
  if _row.parent_file_id is not null then
    raise exception 'Mova o arquivo raiz; os slides acompanham juntos';
  end if;

  -- Mesmos papéis e mesmo acesso ao cliente de rename_file/can_write_file.
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  ) then raise exception 'Sem permissao para mover'; end if;

  if not public.can_access_client(_row.client_id) then
    raise exception 'Sem acesso a este cliente';
  end if;

  if _project_id is not null then
    -- O projeto de destino tem de ser do MESMO cliente.
    if not exists (
      select 1 from public.projects p
      where p.id = _project_id
        and p.client_id = _row.client_id
        and p.deleted_at is null
    ) then
      raise exception 'O projeto de destino nao pertence a este cliente';
    end if;

    -- Arte em uso por conteúdo editorial não muda de projeto por fora: o
    -- conteúdo aponta para o arquivo E para o projeto, e o desencontro
    -- quebraria cada salvar dali em diante, longe da causa.
    if exists (
      select 1 from public.editorial_posts ep
      where ep.primary_file_id = _row.id
        and ep.archived_at is null
        and ep.project_id is distinct from _project_id
    ) or exists (
      select 1 from public.editorial_publications pub
      where pub.file_id = _row.id
        and pub.status <> 'cancelled'
        and pub.project_id is distinct from _project_id
    ) then
      raise exception 'Este arquivo e arte de um conteudo editorial em outro projeto; mova pelo proprio conteudo';
    end if;
  end if;

  update public.files
     set folder = coalesce(_folder, folder),
         project_id = coalesce(_project_id, project_id),
         updated_at = now()
   where id = _file_id
      or parent_file_id = _file_id;

  select * into _row from public.files where id = _file_id;
  return _row;
end $$;

revoke all on function public.move_file(uuid, text, uuid) from public;
revoke execute on function public.move_file(uuid, text, uuid) from anon;
grant execute on function public.move_file(uuid, text, uuid) to authenticated;
