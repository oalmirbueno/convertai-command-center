-- 14/11/2026: Esteira, fase 2. Revisão interna entre agentes com carimbo na
-- peça, e a regra de aprovação do cliente gravada no cadastro.
--
-- Autorização do Almir em 14/11/2026, 21h04 (America/Sao_Paulo): "pode
-- construir e publicar a próxima parte da esteira (caixa Precisa de você e
-- aprovação entre agentes), inclusive a mudança no banco".
--
-- O que esta migration faz:
--
-- A) profiles.modo_aprovacao_do_cliente ('portal' | 'dispensada').
--    A exceção da Softy (regra de 13/11/2026) sai da cabeça e vai para a
--    ficha. Só a Softy Móveis recebe 'dispensada'; todo o resto fica em
--    'portal'. A coluna é só o registro da regra: NENHUMA função de agenda ou
--    de publicação lê esta coluna nesta fase, então ela não pula a aprovação
--    de ninguém. Quem altera: só admin (o gatilho profiles_guard_editable_fields
--    já nega qualquer campo novo a quem não é admin). Quem lê: quem já lê o
--    cadastro (a coluna entra na lista de leitura de profiles).
--
-- B) estudio_trabalhos ganha o carimbo da revisão interna: revisado_por,
--    revisado_em, revisao_decisao ('aprovado' | 'ajuste'), revisao_nota e
--    revisao_arquivo_id (o arquivo principal no momento da revisão, para a
--    tela saber quando o carimbo é de uma arte antiga). A tabela continua sem
--    escrita direta para authenticated: o carimbo entra só pela RPC abaixo.
--
-- C) revisar_trabalho_interno(trabalho, decisão, nota): a equipe (admin,
--    gestor, design, tráfego) carimba a revisão interna de uma peça do
--    Estúdio. Ela espelha o portão da agência do Double-Gate no arquivo
--    (request_file_agency_review e review_file_agency, as mesmas funções de
--    sempre, com as mesmas permissões) e nada além disso.
--
-- O que esta migration NÃO faz: não toca em files.approval_status, não grava
-- client_approved nem client_rejected, não chama decide_file_approval nem
-- aprovar_pelo_cliente, não libera arquivo para o cliente, não agenda, não
-- publica, não altera Auth, política de RLS nem função existente.
--
-- Migration nova e aditiva. O único dado alterado é a ficha da Softy Móveis.
-- Reverter: remover a função e as colunas novas (o valor da Softy some junto
-- com a coluna).

-- ─── A) A regra de aprovação do cliente no cadastro ─────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS modo_aprovacao_do_cliente text NOT NULL DEFAULT 'portal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_modo_aprovacao_do_cliente_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_modo_aprovacao_do_cliente_check
      CHECK (modo_aprovacao_do_cliente IN ('portal', 'dispensada'));
  END IF;
END
$$;

COMMENT ON COLUMN public.profiles.modo_aprovacao_do_cliente IS
  'Como a peça deste cliente segue para o agendamento. portal = só depois da aprovação do cliente (padrão de todos). dispensada = a revisão interna da agência basta (exceção da Softy, regra de 13/11/2026). É o registro da regra: as funções de agenda e de publicação ainda não leem esta coluna.';

-- A leitura de profiles por authenticated é por lista de colunas
-- (20260809044000_profile_select_allowlist); a coluna nova entra na lista.
-- As linhas visíveis continuam sendo as da política profiles_select.
GRANT SELECT (modo_aprovacao_do_cliente) ON public.profiles TO authenticated;

-- Só a Softy Móveis. Nenhum outro cliente muda.
UPDATE public.profiles
   SET modo_aprovacao_do_cliente = 'dispensada'
 WHERE id = '3d08338c-0c3b-453f-a64f-79a55c5711e8'
   AND modo_aprovacao_do_cliente IS DISTINCT FROM 'dispensada';

-- ─── B) O carimbo da revisão interna na peça ────────────────────────────────

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS revisao_decisao text,
  ADD COLUMN IF NOT EXISTS revisao_nota text,
  ADD COLUMN IF NOT EXISTS revisao_arquivo_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.estudio_trabalhos'::regclass
      AND conname = 'estudio_trabalhos_revisao_decisao_check'
  ) THEN
    ALTER TABLE public.estudio_trabalhos
      ADD CONSTRAINT estudio_trabalhos_revisao_decisao_check
      CHECK (revisao_decisao IS NULL OR revisao_decisao IN ('aprovado', 'ajuste'));
  END IF;
END
$$;

COMMENT ON COLUMN public.estudio_trabalhos.revisado_por IS
  'Quem da equipe fez a revisão interna desta peça (carimbo da Esteira). Gravado só por revisar_trabalho_interno.';
COMMENT ON COLUMN public.estudio_trabalhos.revisado_em IS
  'Quando a revisão interna foi registrada.';
COMMENT ON COLUMN public.estudio_trabalhos.revisao_decisao IS
  'Resultado da revisão interna: aprovado ou ajuste. Não é a aprovação do cliente e não a substitui.';
COMMENT ON COLUMN public.estudio_trabalhos.revisao_nota IS
  'O que a revisão interna observou (obrigatório no ajuste).';
COMMENT ON COLUMN public.estudio_trabalhos.revisao_arquivo_id IS
  'Arquivo principal da peça no momento da revisão. Se a arte for trocada depois, o carimbo deixa de valer para a arte nova.';

-- ─── C) A RPC da revisão interna ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.revisar_trabalho_interno(
  p_trabalho_id uuid,
  p_decisao text,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _ator uuid := auth.uid();
  _nota text := left(NULLIF(btrim(COALESCE(p_nota, '')), ''), 1000);
  _t public.estudio_trabalhos%ROWTYPE;
  _arquivo_id uuid;
  _arquivo record;
  _arquivo_aviso text;
  _gestor boolean;
  _repetido boolean := false;
BEGIN
  -- Só a equipe autenticada. O cliente do portal nunca passa daqui.
  IF _ator IS NULL OR NOT (
    public.has_role(_ator, 'admin'::public.app_role)
    OR public.has_role(_ator, 'manager'::public.app_role)
    OR public.has_role(_ator, 'design'::public.app_role)
    OR public.has_role(_ator, 'traffic'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'só a equipe da agência registra a revisão interna' USING ERRCODE = '42501';
  END IF;
  IF p_trabalho_id IS NULL THEN
    RAISE EXCEPTION 'informe a peça a revisar' USING ERRCODE = '22023';
  END IF;
  IF p_decisao IS NULL OR p_decisao NOT IN ('aprovado', 'ajuste') THEN
    RAISE EXCEPTION 'a decisão da revisão interna é aprovado ou ajuste' USING ERRCODE = '22023';
  END IF;
  IF p_decisao = 'ajuste' AND COALESCE(length(_nota), 0) < 10 THEN
    RAISE EXCEPTION 'ao pedir ajuste, diga o que precisa mudar (pelo menos 10 caracteres)' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _t FROM public.estudio_trabalhos WHERE id = p_trabalho_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_access_client(_t.client_id) THEN
    RAISE EXCEPTION 'peça não encontrada ou sem acesso a este cliente' USING ERRCODE = '42501';
  END IF;

  _arquivo_id := CASE WHEN COALESCE(cardinality(_t.file_ids), 0) > 0 THEN _t.file_ids[1] ELSE NULL END;

  -- Idempotência: a mesma decisão para a mesma arte devolve o estado atual.
  IF _t.revisao_decisao = p_decisao
     AND _t.revisado_em IS NOT NULL
     AND _t.revisao_arquivo_id IS NOT DISTINCT FROM _arquivo_id THEN
    _repetido := true;
  ELSE
    IF _t.status NOT IN ('pronto', 'entregue') THEN
      RAISE EXCEPTION 'a arte desta peça ainda não está pronta para revisão' USING ERRCODE = '22023';
    END IF;
    -- Depois que a peça seguiu para o cliente, a revisão interna não a traz de volta.
    IF _t.entrega_status IN ('aguardando_cliente', 'aprovado', 'agendado') THEN
      RAISE EXCEPTION 'esta peça já seguiu para o cliente; a revisão interna não se aplica mais' USING ERRCODE = '22023';
    END IF;

    UPDATE public.estudio_trabalhos
       SET revisado_por = _ator,
           revisado_em = now(),
           revisao_decisao = p_decisao,
           revisao_nota = _nota,
           revisao_arquivo_id = _arquivo_id
     WHERE id = _t.id;
  END IF;

  -- O portão da agência no arquivo (Double-Gate), pelas funções de sempre.
  -- Só o arquivo ainda interno e não travado entra; arquivo já liberado ao
  -- cliente não é tocado. Quem não é gestor do cliente deixa o carimbo e o
  -- portão do arquivo segue esperando o gestor, como já era.
  -- Esta reconciliação roda também na repetição: se o carimbo já existia e o
  -- portão ficou pendente (quem carimbou não era gestor, ou o espelhamento
  -- falhou), o gestor conclui na segunda chamada, sem regravar o carimbo.
  IF _arquivo_id IS NOT NULL THEN
      BEGIN
        SELECT f.id, f.visibility, f.agency_approval_status, f.locked_at, f.status
          INTO _arquivo
          FROM public.files f
         WHERE f.id = _arquivo_id AND f.parent_file_id IS NULL AND f.client_id = _t.client_id;

        IF _arquivo.id IS NOT NULL AND _arquivo.visibility = 'internal' AND _arquivo.locked_at IS NULL THEN
          _gestor := public.can_manage_client(_t.client_id);

          IF p_decisao = 'aprovado'
             AND _arquivo.agency_approval_status = 'not_requested'
             AND COALESCE(_arquivo.status, 'ready') = 'ready' THEN
            PERFORM public.request_file_agency_review(_arquivo_id);
            _arquivo.agency_approval_status := 'pending';
          END IF;

          IF _arquivo.agency_approval_status = 'pending' THEN
            IF _gestor THEN
              PERFORM public.review_file_agency(
                _arquivo_id,
                CASE WHEN p_decisao = 'aprovado' THEN 'approved' ELSE 'rejected' END,
                CASE WHEN p_decisao = 'ajuste' THEN _nota ELSE NULL END
              );
            ELSE
              _arquivo_aviso := 'o portão da agência neste arquivo segue pendente até um gestor do cliente decidir';
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- O carimbo da peça vale mesmo se o arquivo não puder acompanhar; o
        -- motivo volta na resposta e o arquivo fica como estava.
        _arquivo_aviso := left(SQLERRM, 300);
      END;
  END IF;

  SELECT * INTO _t FROM public.estudio_trabalhos WHERE id = p_trabalho_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ja_registrado', _repetido,
    'trabalho_id', _t.id,
    'client_id', _t.client_id,
    'revisao_decisao', _t.revisao_decisao,
    'revisado_por', _t.revisado_por,
    'revisado_em', _t.revisado_em,
    'revisao_nota', _t.revisao_nota,
    'entrega_status', _t.entrega_status,
    'arquivo_id', _arquivo_id,
    'arquivo_agencia', (
      SELECT f.agency_approval_status FROM public.files f WHERE f.id = _arquivo_id
    ),
    'arquivo_aviso', _arquivo_aviso,
    -- Só informa a regra do cadastro. Esta função nunca agenda nem publica,
    -- nem para o cliente com a aprovação dispensada.
    'modo_aprovacao_do_cliente', (
      SELECT p.modo_aprovacao_do_cliente FROM public.profiles p WHERE p.id = _t.client_id
    ),
    'aprovacao_do_cliente', 'não alterada: a revisão interna não substitui a aprovação do cliente'
  );
END;
$function$;

COMMENT ON FUNCTION public.revisar_trabalho_interno(uuid, text, text) IS
  'Revisão interna de uma peça do Estúdio (equipe: admin, gestor, design, tráfego). Carimba quem revisou e quando e espelha o portão da agência no arquivo. Nunca aprova pelo cliente, nunca agenda e nunca publica.';

REVOKE ALL ON FUNCTION public.revisar_trabalho_interno(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revisar_trabalho_interno(uuid, text, text) TO authenticated;
