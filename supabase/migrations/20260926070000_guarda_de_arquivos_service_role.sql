-- Anti-bug 26/09 (frente AB): guarda de arquivos recusa TODA escrita da chave de serviço.
--
-- Causa: a auditoria de 21/09 (20260921140000_auditoria_banco_correcoes.sql, item 4)
-- pôs `AND public.can_read_file(root.id)` em file_root_state (file_guard_state já
-- tinha). can_read_file olha auth.uid(), que é NULL na chave de serviço; então,
-- para as Edge Functions, as duas funções não devolvem linha, _root_editable fica
-- NULL e files_secure_guard levanta "file versions under review or released are
-- immutable" em qualquer UPDATE/DELETE de files, e "carousel parent must belong to
-- the same client" / "revision source not found" em INSERT de filho/revisão.
--
-- Evidência (26/09, somente leitura):
-- * postgres_logs 24 h: 1.500 x "file versions under review or released are immutable",
--   todos em UPDATE de files pelo PostgREST (materiais-classificar a cada 30 min).
-- * files b65d6e19-419a-4873-b964-86fdebf75a68: internal / not_requested / none / sem trava
--   (editável) e mesmo assim o update do classificador cai.
-- * Conferido com `begin read only; set local role service_role; ...`: file_root_state
--   devolve 0 linhas e can_read_file = false para a chave de serviço.
-- * Upload pelo MCP (finalize, que roda com a chave de serviço) não passa de 'uploading':
--   8561e1af-b134-4914-86d7-e5877ba35671 (25/09, objeto existe no Storage) segue
--   'uploading'; por isso o "Liberar agora" do admin caiu 12 vezes em 26/09 20:37-20:40
--   com "file must pass agency review before release" (status <> 'ready').
--
-- Correção: a chave de serviço (auth.role() = 'service_role') lê o estado da raiz,
-- como já lia a tabela inteira (BYPASSRLS). Nada muda para anon/authenticated: a
-- guarda continua valendo para a chave de serviço (ela NÃO é escrita confiável em
-- files_secure_guard), só volta a enxergar o estado da raiz. Idempotente, só amplia.

CREATE OR REPLACE FUNCTION public.file_root_state(p_root_id uuid)
RETURNS TABLE (
  root_locked_at timestamptz,
  root_visibility text,
  root_agency_status text,
  root_approval_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    root.locked_at,
    root.visibility::text,
    root.agency_approval_status::text,
    root.approval_status::text
  FROM public.files AS root
  WHERE root.id = p_root_id
    AND (auth.role() = 'service_role' OR public.can_read_file(root.id))
$$;

REVOKE ALL ON FUNCTION public.file_root_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.file_root_state(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.file_guard_state(p_file_id uuid)
RETURNS TABLE (
  client_id uuid,
  parent_file_id uuid,
  locked_at timestamptz,
  visibility text,
  agency_approval_status text,
  approval_status text,
  version integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT file_row.client_id, file_row.parent_file_id, file_row.locked_at, file_row.visibility::text,
         file_row.agency_approval_status::text, file_row.approval_status::text, file_row.version
  FROM public.files AS file_row
  WHERE file_row.id = p_file_id
    AND (auth.role() = 'service_role' OR public.can_read_file(file_row.id))
  FOR UPDATE
$$;

-- Conferência depois de aplicar (só leitura; deve dar 1 e true):
-- begin read only;
--   select set_config('request.jwt.claims', '{"role":"service_role"}', true);
--   set local role service_role;
--   select count(*) from public.file_root_state('b65d6e19-419a-4873-b964-86fdebf75a68');
-- rollback;
--
-- Opcional (dono decide): mensagem clara no "Liberar agora" quando o envio não terminou.
-- Hoje o admin vê "file must pass agency review before release" (inglês e enganoso).
-- Para isso, em public.admin_release_file_now, logo depois da checagem de
-- storage_path/file_url, acrescentar:
--   IF COALESCE(_file.status, 'ready') <> 'ready' THEN
--     RAISE EXCEPTION 'o envio deste arquivo não terminou (estado: %). Conclua o envio ou suba de novo.', _file.status;
--   END IF;
--
-- Pendência de dados (não aplicar às cegas): 3 arquivos raiz presos em 'uploading'
-- no bucket mcp-files: 8561e1af-... (objeto existe: refazer o finalize pelo MCP depois
-- desta correção), 8851b057-... (objeto NÃO existe: subir de novo) e 9c9a5d00-...
-- (de 07/2026, já em aprovação).
