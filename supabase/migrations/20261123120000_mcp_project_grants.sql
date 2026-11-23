-- MCP: chave project-scoped presa a UM projeto e UM operador interno.
-- Migration incremental, somente arquivo: NÃO aplicada. Exige plano, backup restaurável e
-- autorização explícita (AGENTS.md). Aditiva: nenhuma coluna/dado existente é alterado. Contatos com tabelas existentes:
--   * api_keys: trigger que torna o marcador de escopo imutável (rollback: DROP TRIGGER api_keys_project_marker_guard ON public.api_keys);
--   * projects: trigger AFTER que só REVOGA concessões (falha na revogação não é engolida: a operação do projeto falha junto)
--     (rollback: DROP TRIGGER mcp_project_grants_revoke_on_project_change ON public.projects).
--
-- Modelo: a chave project-scoped nasce EXCLUSIVAMENTE com o escopo marcador 'mcp:project' (sem
-- escopos legados de leitura nem admin). O servidor só autoriza leitura quando existe concessão
-- ativa; sem linha, revogada, projeto apagado/arquivado, lookup com erro ou tabela ausente => esta chave é negada. Chaves
-- sem o marcador seguem pelo caminho de sempre e nunca consultam esta tabela. Chave legada não é
-- reaproveitada: o trigger abaixo só aceita chave cujos escopos sejam exatamente {mcp:project}.
--
-- Concessão IMUTÁVEL: api_key_id, project_id, client_id, operator_slug, allow_video_upload, created_by e
-- created_at nunca mudam. A única transição é revoked_at NULL -> timestamp, monotônica e DEFINITIVA:
-- nem limpar, nem alterar, nem criar nova linha para a mesma chave (índice único total). Para dar acesso
-- de novo: chave NOVA.
--
-- Referência viva x identificação histórica: project_id/client_id NÃO têm FK. A linha registra a quem a chave foi
-- ligada (histórico, auditoria) sem impedir a exclusão normal do projeto ou do cliente, com concessão ativa ou revogada.
-- Que o projeto ainda exista, seja do cliente, não esteja apagado nem arquivado é conferido por mcp_project_is_live()
-- no INSERT e pela autenticação do servidor a CADA chamada (nega na hora, sem depender de trigger ou cache).
-- Auditoria: mcp_audit_log.key_id segue ON DELETE SET NULL e esta tabela não toca nele.
--
-- Operador: internal_operators.slug (operador interno), nunca profiles.id humano.
--
-- Rollback lógico (sem apagar a concessão e sem abrir escopo): desativar a CHAVE.
--   UPDATE public.api_keys SET is_active = false, revoked_at = COALESCE(revoked_at, now())
--    WHERE id IN (SELECT api_key_id FROM public.mcp_project_grants);
--   (a concessão fica registrada; sem chave ativa nada autentica, e com o marcador a ausência/revogação
--    da concessão também nega, nunca libera.)
-- Rollback do schema (só se autorizado, depois de desativar as chaves e dropar o trigger em projects): DROP TABLE public.mcp_project_grants;

CREATE TABLE IF NOT EXISTS public.mcp_project_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a chave não some sem rastro (o caminho suportado é desativá-la).
  api_key_id    uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE RESTRICT,
  -- Identificação histórica, sem FK de propósito (ver cabeçalho).
  project_id    uuid NOT NULL,
  client_id     uuid NOT NULL,
  operator_slug text NOT NULL REFERENCES public.internal_operators(slug) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Reservado para o upload de MP4. Só pode ser false: o servidor mantém a escrita fechada neste lote.
  allow_video_upload boolean NOT NULL DEFAULT false CHECK (allow_video_upload = false),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

-- UMA concessão por chave, para sempre (índice total, não parcial): revogada, nenhuma linha nova é aceita para a mesma chave.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_project_grants_one_per_key
  ON public.mcp_project_grants (api_key_id);
CREATE INDEX IF NOT EXISTS mcp_project_grants_project_idx
  ON public.mcp_project_grants (project_id);

-- Projeto "vivo": existe, é do cliente, nem ele nem o cliente apagados, e não arquivado/cancelado.
-- Mesma regra de isProjectLive() em mcp-project-access.ts.
CREATE OR REPLACE FUNCTION public.mcp_project_is_live(p_project_id uuid, p_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
      JOIN public.profiles c ON c.id = p.client_id AND c.deleted_at IS NULL
     WHERE p.id = p_project_id AND p.client_id = p_client_id AND p.deleted_at IS NULL
       AND lower(coalesce(p.status, '')) NOT IN ('archived', 'cancelled', 'canceled', 'deleted')
  )
$$;
REVOKE ALL ON FUNCTION public.mcp_project_is_live(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_project_is_live(uuid, uuid) TO service_role;

-- INSERT: só concessão ATIVA, de chave ativa e marcada, com projeto vivo do cliente e operador ativo.
-- UPDATE: só revoked_at NULL -> timestamp; tudo mais congelado; revogada nunca muda.
CREATE OR REPLACE FUNCTION public.mcp_project_grants_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.api_key_id IS DISTINCT FROM OLD.api_key_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.operator_slug IS DISTINCT FROM OLD.operator_slug
       OR NEW.allow_video_upload IS DISTINCT FROM OLD.allow_video_upload
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'mcp_project_grants: a concessão é imutável; só revoked_at pode ser preenchido';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'mcp_project_grants: concessão revogada é definitiva';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'mcp_project_grants: a concessão nasce ativa';
  END IF;
  -- Ordem fixa de travas (igual à conferência viva das RPCs): PROJETO primeiro, depois chave e operador.
  -- O trigger de revogação em projects trava o projeto e depois as concessões; travar o projeto antes de
  -- qualquer outra linha evita ciclo. A trava é pelo id (sem filtro de vida): o projeto morto também
  -- serializa, e a vida é REVALIDADA depois, em comandos novos (READ COMMITTED: snapshot novo após a espera).
  PERFORM 1 FROM public.projects p WHERE p.id = NEW.project_id FOR SHARE OF p;
  -- FOR SHARE: serializa contra UPDATE concorrente da linha da chave.
  IF NOT EXISTS (
    SELECT 1 FROM public.api_keys k
     WHERE k.id = NEW.api_key_id AND k.scopes = ARRAY['mcp:project']::text[]
       AND k.audience = 'mcp' AND k.is_active = true AND k.revoked_at IS NULL
       FOR SHARE
  ) THEN
    RAISE EXCEPTION 'mcp_project_grants: a chave deve estar ativa e ter exatamente o escopo mcp:project';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.internal_operators o WHERE o.slug = NEW.operator_slug AND o.status = 'active' FOR SHARE
  ) THEN
    RAISE EXCEPTION 'mcp_project_grants: operador interno inexistente ou inativo';
  END IF;
  -- Revalidação depois das travas: UPDATE/DELETE concorrente do projeto já terminou (ou espera esta transação).
  IF NOT public.mcp_project_is_live(NEW.project_id, NEW.client_id) THEN
    RAISE EXCEPTION 'mcp_project_grants: project_id não pertence a client_id, está apagado ou arquivado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mcp_project_grants_check ON public.mcp_project_grants;
CREATE TRIGGER mcp_project_grants_check
  BEFORE INSERT OR UPDATE ON public.mcp_project_grants
  FOR EACH ROW EXECUTE FUNCTION public.mcp_project_grants_check();

-- Projeto apagado, arquivado, cancelado ou com client_id alterado revoga (definitivamente) as concessões ativas dele.
-- Roda DEPOIS da operação, na mesma transação; falha na revogação NÃO é engolida (a operação inteira falha). A negação
-- imediata também não depende deste trigger: a autenticação confere o projeto vivo a cada chamada.
CREATE OR REPLACE FUNCTION public.mcp_project_grants_revoke_on_project_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Sem EXCEPTION: se a revogação falhar, a operação do projeto falha junto (nunca engole o erro).
  IF TG_OP = 'DELETE' THEN
    UPDATE public.mcp_project_grants SET revoked_at = now() WHERE project_id = OLD.id AND revoked_at IS NULL;
  ELSIF NEW.deleted_at IS NOT NULL
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR lower(coalesce(NEW.status, '')) IN ('archived', 'cancelled', 'canceled', 'deleted') THEN
    UPDATE public.mcp_project_grants SET revoked_at = now() WHERE project_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mcp_project_grants_revoke_on_project_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mcp_project_grants_revoke_on_project_change ON public.projects;
CREATE TRIGGER mcp_project_grants_revoke_on_project_change
  AFTER UPDATE OF deleted_at, status, client_id OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.mcp_project_grants_revoke_on_project_change();

-- Marcador imutável em api_keys.scopes: edição normal de escopos NÃO converte chave legada em
-- project-scoped (nem o inverso), inclusive depois de revogada a concessão ou desativada a chave.
-- Único caminho para o marcador: criar a chave NOVA já com scopes = {mcp:project} exatamente (INSERT).
-- Chave marcada tem escopos fixos para sempre; para mudar o acesso, desative-a e emita outra.
-- Este lote NÃO habilita a emissão: o trigger só restringe, não cria chaves nem concessões.
CREATE OR REPLACE FUNCTION public.api_keys_project_marker_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  novo_marcado boolean := 'mcp:project' = ANY (COALESCE(NEW.scopes, ARRAY[]::text[]));
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF novo_marcado AND (NEW.scopes IS DISTINCT FROM ARRAY['mcp:project']::text[] OR NEW.audience IS DISTINCT FROM 'mcp') THEN
      RAISE EXCEPTION 'api_keys: chave de projeto exige somente mcp:project e audiência mcp';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: qualquer troca de escopos que toque o marcador (entrada, saída ou alteração de chave marcada) é recusada.
  IF NEW.scopes IS DISTINCT FROM OLD.scopes
     AND (novo_marcado OR 'mcp:project' = ANY (COALESCE(OLD.scopes, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'api_keys: o escopo mcp:project é imutável (não converte chave legada nem project-scoped)';
  END IF;
  IF novo_marcado THEN
    IF NEW.audience IS DISTINCT FROM OLD.audience THEN
      RAISE EXCEPTION 'api_keys: audiência da chave de projeto é imutável';
    END IF;
    IF (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.is_active IS NOT TRUE AND NEW.is_active IS TRUE) THEN
      RAISE EXCEPTION 'api_keys: a revogação da chave de projeto é definitiva';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_project_marker_guard ON public.api_keys;
CREATE TRIGGER api_keys_project_marker_guard
  BEFORE INSERT OR UPDATE OF scopes, audience, is_active, revoked_at ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.api_keys_project_marker_guard();

-- A concessão nunca é apagada (rollback = desativar a chave; revogar = preencher revoked_at).
CREATE OR REPLACE FUNCTION public.mcp_project_grants_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'mcp_project_grants: concessão não pode ser apagada; preencha revoked_at e desative a chave';
END;
$$;

DROP TRIGGER IF EXISTS mcp_project_grants_no_delete ON public.mcp_project_grants;
CREATE TRIGGER mcp_project_grants_no_delete
  BEFORE DELETE ON public.mcp_project_grants
  FOR EACH ROW EXECUTE FUNCTION public.mcp_project_grants_no_delete();

-- Somente service_role (o MCP) lê e escreve. Sem política para anon/authenticated: RLS nega tudo.
ALTER TABLE public.mcp_project_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_project_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mcp_project_grants TO service_role;

COMMENT ON TABLE public.mcp_project_grants IS
  'Prende uma chave MCP com escopo mcp:project a um projeto e a um operador interno. Imutável; revogação definitiva. Sem concessão ativa e projeto vivo a chave é negada.';
