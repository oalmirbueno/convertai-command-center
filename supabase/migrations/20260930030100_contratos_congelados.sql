-- Contratos montados por modelo, congelados com hash e assinados com trilha
-- (frente CON, 30/09/2026).
--
-- O que já existe continua igual: contracts (sign_token, assinaturas com
-- nome, IP e data), contracts_secure_guard, complete_contract_signature, o
-- registro em Arquivos (files, source contract-public) e o evento
-- contract_signed. Contrato de arquivo enviado (origem 'arquivo') segue o
-- caminho antigo. O que muda é só para origem 'modelo':
--
-- 1) contracts ganha o modelo usado, as variáveis, os serviços, as cláusulas
--    alteradas (com diff confirmado), o texto congelado, o hash SHA-256, o
--    PDF congelado, a versão (versao_de / substituido_por) e o arquivamento.
-- 2) contrato_eventos: a trilha (criado, congelado, enviado, visualizado,
--    assinado, substituído...), só de acréscimo. É também o gancho do
--    documento de entrega (evento 'concluido' com o resumo e as provas).
-- 3) contracts_modelo_guard: contrato de modelo só é escrito pelo servidor;
--    o texto congelado nunca muda (nem por RPC); ir para 'sent' exige texto,
--    hash conferido pelo banco (sha256 do texto em UTF-8) e PDF congelado.
-- 4) RPCs (security definer, só service_role):
--    - contrato_substituir: a versão nova invalida o link da anterior;
--    - contrato_arquivar: cancelar (mata o link) ou arquivar o assinado;
--    - contrato_concluir_assinatura: assinatura do cliente conferindo o hash
--      que ele viu; o PDF final (com a página de carimbo) vai para Arquivos
--      pelo complete_contract_signature de sempre (files + contract_signed,
--      que já avisa a equipe).
-- Idempotente e só amplia. Não enfraquece RLS nem can_access_client.

-- --------------------------------------------------------------- colunas
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'arquivo',
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS versao_de uuid,
  ADD COLUMN IF NOT EXISTS substituido_por uuid,
  ADD COLUMN IF NOT EXISTS substituido_em timestamptz,
  ADD COLUMN IF NOT EXISTS proposta_id uuid,
  ADD COLUMN IF NOT EXISTS servicos text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS variaveis jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS modelo_versoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS clausulas_alteradas jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS documento_texto text,
  ADD COLUMN IF NOT EXISTS documento_hash text,
  ADD COLUMN IF NOT EXISTS documento_pdf_url text,
  ADD COLUMN IF NOT EXISTS documento_pdf_hash text,
  ADD COLUMN IF NOT EXISTS congelado_em timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_final_hash text,
  ADD COLUMN IF NOT EXISTS admin_signature_email text,
  ADD COLUMN IF NOT EXISTS client_signature_email text,
  ADD COLUMN IF NOT EXISTS client_signature_user_agent text,
  ADD COLUMN IF NOT EXISTS arquivado_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivado_por uuid,
  ADD COLUMN IF NOT EXISTS motivo_arquivo text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_origem_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_origem_check CHECK (origem IN ('arquivo', 'modelo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_versao_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_versao_check CHECK (versao >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_documento_hash_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_documento_hash_check
      CHECK (documento_hash IS NULL OR documento_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_variaveis_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_variaveis_check
      CHECK (jsonb_typeof(variaveis) = 'object' AND jsonb_typeof(clausulas_alteradas) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_versao_de_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_versao_de_fkey
      FOREIGN KEY (versao_de) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_substituido_por_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_substituido_por_fkey
      FOREIGN KEY (substituido_por) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS contracts_cliente_origem_idx ON public.contracts (client_id, origem, created_at DESC);
CREATE INDEX IF NOT EXISTS contracts_versao_de_idx ON public.contracts (versao_de) WHERE versao_de IS NOT NULL;
-- Uma proposta aceita gera um contrato só (as versões novas apontam para ele).
CREATE UNIQUE INDEX IF NOT EXISTS contracts_uma_por_proposta_idx
  ON public.contracts (proposta_id)
  WHERE proposta_id IS NOT NULL AND versao_de IS NULL AND status <> 'cancelled';

CREATE SEQUENCE IF NOT EXISTS public.contrato_numero_seq;
REVOKE ALL ON SEQUENCE public.contrato_numero_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.contrato_numero_seq TO service_role;

COMMENT ON COLUMN public.contracts.origem IS 'arquivo: PDF enviado pela equipe (caminho antigo). modelo: montado pelos modelos da frente CON.';
COMMENT ON COLUMN public.contracts.documento_texto IS 'Texto canônico congelado no envio (contrato-modelo.ts). Nunca muda depois de congelado.';
COMMENT ON COLUMN public.contracts.documento_hash IS 'SHA-256 (hex) de documento_texto em UTF-8: o código de integridade mostrado ao cliente.';
COMMENT ON COLUMN public.contracts.clausulas_alteradas IS 'Cláusulas reescritas com a diferença mostrada e confirmada: [{chave, texto, texto_original, motivo, confirmada_por, confirmada_em}].';

-- --------------------------------------------------------------- trilha
CREATE TABLE IF NOT EXISTS public.contrato_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  resumo text NOT NULL DEFAULT '',
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contrato_eventos_tipo_check CHECK (tipo IN (
    'criado', 'gerado_do_aceite', 'servicos_mudaram', 'variaveis_salvas',
    'clausula_alterada', 'clausula_restaurada', 'congelado', 'assinado_agencia',
    'enviado_email', 'mensagem_copiada', 'visualizado', 'assinado_cliente',
    'concluido', 'nova_versao', 'substituido', 'cancelado', 'arquivado'
  )),
  CONSTRAINT contrato_eventos_detalhe_check CHECK (jsonb_typeof(detalhe) = 'object')
);

CREATE INDEX IF NOT EXISTS contrato_eventos_contrato_idx ON public.contrato_eventos (contract_id, criado_em);
CREATE INDEX IF NOT EXISTS contrato_eventos_cliente_idx ON public.contrato_eventos (client_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.contrato_eventos_so_acrescenta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE'
    AND NOT EXISTS (SELECT 1 FROM public.contracts AS c WHERE c.id = OLD.contract_id) THEN
    -- O rascunho foi apagado: a trilha dele vai junto (cascata).
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a trilha do contrato só recebe eventos novos';
END
$$;

DROP TRIGGER IF EXISTS contrato_eventos_so_acrescenta_trg ON public.contrato_eventos;
CREATE TRIGGER contrato_eventos_so_acrescenta_trg
  BEFORE UPDATE OR DELETE ON public.contrato_eventos
  FOR EACH ROW EXECUTE FUNCTION public.contrato_eventos_so_acrescenta();

ALTER TABLE public.contrato_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contrato_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_eventos TO authenticated;
GRANT ALL ON public.contrato_eventos TO service_role;

DROP POLICY IF EXISTS contrato_eventos_equipe_le ON public.contrato_eventos;
CREATE POLICY contrato_eventos_equipe_le ON public.contrato_eventos
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id));

-- --------------------------------------------------------------- guarda do contrato de modelo
CREATE OR REPLACE FUNCTION public.contracts_modelo_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _service boolean := auth.role() = 'service_role';
  _trusted boolean := current_user NOT IN ('anon', 'authenticated', 'service_role', 'authenticator');
BEGIN
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.documento_texto IS NOT NULL OR NEW.documento_hash IS NOT NULL
      OR NEW.documento_pdf_url IS NOT NULL OR NEW.congelado_em IS NOT NULL
      OR NEW.substituido_por IS NOT NULL OR NEW.arquivado_em IS NOT NULL THEN
      RAISE EXCEPTION 'contrato novo nasce sem texto congelado';
    END IF;
    IF NEW.origem = 'modelo' THEN
      IF NOT _service AND NOT _trusted THEN
        RAISE EXCEPTION 'contrato de modelo é criado pela função contratos';
      END IF;
      IF NEW.numero IS NULL THEN
        NEW.numero := 'CT-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-'
          || lpad(nextval('public.contrato_numero_seq')::text, 4, '0');
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- O texto congelado não muda, nem por RPC.
  IF OLD.congelado_em IS NOT NULL AND (
    NEW.documento_texto IS DISTINCT FROM OLD.documento_texto
    OR NEW.documento_hash IS DISTINCT FROM OLD.documento_hash
    OR NEW.documento_pdf_url IS DISTINCT FROM OLD.documento_pdf_url
    OR NEW.documento_pdf_hash IS DISTINCT FROM OLD.documento_pdf_hash
    OR NEW.congelado_em IS DISTINCT FROM OLD.congelado_em
    OR NEW.variaveis IS DISTINCT FROM OLD.variaveis
    OR NEW.servicos IS DISTINCT FROM OLD.servicos
    OR NEW.clausulas_alteradas IS DISTINCT FROM OLD.clausulas_alteradas
    OR NEW.modelo_versoes IS DISTINCT FROM OLD.modelo_versoes
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.numero IS DISTINCT FROM OLD.numero
  ) THEN
    RAISE EXCEPTION 'contrato congelado não muda: crie uma versão nova';
  END IF;
  IF NEW.origem IS DISTINCT FROM OLD.origem THEN
    RAISE EXCEPTION 'a origem do contrato não muda';
  END IF;

  IF _trusted THEN
    RETURN NEW;
  END IF;

  IF OLD.origem = 'modelo' AND NOT _service THEN
    -- Pela tela, só título e descrição; o resto passa pela função contratos.
    IF (to_jsonb(NEW) - 'title' - 'description' - 'updated_at')
      IS DISTINCT FROM (to_jsonb(OLD) - 'title' - 'description' - 'updated_at') THEN
      RAISE EXCEPTION 'contrato de modelo muda pela função contratos';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.substituido_por IS DISTINCT FROM OLD.substituido_por
    OR NEW.substituido_em IS DISTINCT FROM OLD.substituido_em
    OR NEW.arquivado_em IS DISTINCT FROM OLD.arquivado_em
    OR NEW.arquivado_por IS DISTINCT FROM OLD.arquivado_por
    OR NEW.pdf_final_hash IS DISTINCT FROM OLD.pdf_final_hash
    OR NEW.client_signature_email IS DISTINCT FROM OLD.client_signature_email
    OR NEW.client_signature_user_agent IS DISTINCT FROM OLD.client_signature_user_agent
    OR NEW.versao_de IS DISTINCT FROM OLD.versao_de
    OR NEW.proposta_id IS DISTINCT FROM OLD.proposta_id THEN
    RAISE EXCEPTION 'substituir, arquivar e assinar passam pelas RPCs de contrato';
  END IF;

  IF NEW.congelado_em IS NOT NULL AND OLD.congelado_em IS NULL THEN
    IF NEW.documento_texto IS NULL
      OR NEW.documento_hash IS DISTINCT FROM encode(sha256(convert_to(NEW.documento_texto, 'UTF8')), 'hex')
      OR NEW.documento_pdf_url IS NULL
      OR NEW.original_file_url IS DISTINCT FROM NEW.documento_pdf_url THEN
      RAISE EXCEPTION 'congelar exige o texto, o hash conferido e o PDF congelado';
    END IF;
  END IF;
  IF NEW.congelado_em IS NULL AND (NEW.documento_texto IS NOT NULL OR NEW.documento_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'texto de contrato só entra congelado';
  END IF;

  IF OLD.origem = 'modelo' AND OLD.status = 'draft' AND NEW.status = 'sent' AND NEW.congelado_em IS NULL THEN
    RAISE EXCEPTION 'contrato de modelo só é enviado congelado';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.contracts_modelo_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS contracts_modelo_guard_trg ON public.contracts;
CREATE TRIGGER contracts_modelo_guard_trg
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_modelo_guard();

-- --------------------------------------------------------------- versão nova invalida o link antigo
CREATE OR REPLACE FUNCTION public.contrato_substituir(p_antigo uuid, p_novo uuid, p_ator uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _a public.contracts%ROWTYPE;
  _n public.contracts%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'somente a função contratos substitui versões';
  END IF;
  SELECT * INTO _a FROM public.contracts WHERE id = p_antigo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrato antigo não encontrado'; END IF;
  SELECT * INTO _n FROM public.contracts WHERE id = p_novo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'versão nova não encontrada'; END IF;
  IF _a.origem <> 'modelo' OR _n.origem <> 'modelo' THEN
    RAISE EXCEPTION 'só contrato de modelo ganha versão nova';
  END IF;
  IF _n.client_id <> _a.client_id OR _n.versao_de IS DISTINCT FROM _a.id OR _n.status <> 'draft' THEN
    RAISE EXCEPTION 'a versão nova precisa ser rascunho do mesmo cliente, ligada a esta';
  END IF;
  IF _a.substituido_por IS NOT NULL THEN
    RAISE EXCEPTION 'este contrato já foi substituído';
  END IF;
  IF _a.status <> 'sent' OR _a.client_signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'só contrato enviado e ainda não assinado pelo cliente é substituído';
  END IF;

  UPDATE public.contracts
     SET status = 'substituido', substituido_por = _n.id, substituido_em = now()
   WHERE id = _a.id;

  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe, criado_por)
  VALUES (_a.id, _a.client_id, 'substituido',
    'Substituído pela versão ' || _n.versao || '. O link desta versão deixou de valer.',
    jsonb_build_object('nova_versao_id', _n.id, 'versao_nova', _n.versao), p_ator);

  RETURN jsonb_build_object('antigo', _a.id, 'novo', _n.id, 'status_antigo', 'substituido');
END
$$;

REVOKE ALL ON FUNCTION public.contrato_substituir(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_substituir(uuid, uuid, uuid) TO service_role;

-- --------------------------------------------------------------- cancelar e arquivar (apagar = arquivar)
CREATE OR REPLACE FUNCTION public.contrato_arquivar(p_contract uuid, p_ator uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _c public.contracts%ROWTYPE;
  _cancelar boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'somente a função contratos arquiva contratos';
  END IF;
  SELECT * INTO _c FROM public.contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrato não encontrado'; END IF;
  IF _c.arquivado_em IS NOT NULL THEN
    RETURN jsonb_build_object('id', _c.id, 'status', _c.status, 'ja_estava', true);
  END IF;
  _cancelar := _c.status IN ('draft', 'sent') AND _c.client_signed_at IS NULL;

  UPDATE public.contracts
     SET status = CASE WHEN _cancelar THEN 'cancelled' ELSE status END,
         arquivado_em = now(),
         arquivado_por = p_ator,
         motivo_arquivo = left(NULLIF(btrim(COALESCE(p_motivo, '')), ''), 500)
   WHERE id = _c.id;

  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe, criado_por)
  VALUES (_c.id, _c.client_id, CASE WHEN _cancelar THEN 'cancelado' ELSE 'arquivado' END,
    CASE WHEN _cancelar THEN 'Cancelado. O link de assinatura deixou de valer.' ELSE 'Arquivado.' END,
    jsonb_build_object('status_anterior', _c.status, 'motivo', left(COALESCE(p_motivo, ''), 500)), p_ator);

  RETURN jsonb_build_object('id', _c.id, 'status', CASE WHEN _cancelar THEN 'cancelled' ELSE _c.status END, 'ja_estava', false);
END
$$;

REVOKE ALL ON FUNCTION public.contrato_arquivar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_arquivar(uuid, uuid, text) TO service_role;

-- --------------------------------------------------------------- assinatura do cliente (contrato de modelo)
CREATE OR REPLACE FUNCTION public.contrato_concluir_assinatura(
  p_token text,
  p_nome text,
  p_email text,
  p_ip text,
  p_user_agent text,
  p_hash_visto text,
  p_assinado_em timestamptz,
  p_pdf_path text,
  p_pdf_nome text,
  p_pdf_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _c public.contracts%ROWTYPE;
  _nome text := NULLIF(btrim(p_nome), '');
  _email text := lower(NULLIF(btrim(p_email), ''));
  _file uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'contract completion requires the trusted signing backend';
  END IF;
  IF NULLIF(btrim(p_token), '') IS NULL OR _nome IS NULL OR length(_nome) > 200 THEN
    RAISE EXCEPTION 'invalid contract signature input';
  END IF;
  IF _email IS NULL OR length(_email) > 254 OR _email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
    RAISE EXCEPTION 'e-mail de assinatura inválido';
  END IF;

  SELECT * INTO _c FROM public.contracts WHERE sign_token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF _c.origem <> 'modelo' THEN
    RAISE EXCEPTION 'contrato de arquivo assina por complete_contract_signature';
  END IF;
  IF _c.status <> 'sent' OR _c.admin_signed_at IS NULL OR _c.client_signed_at IS NOT NULL OR _c.congelado_em IS NULL THEN
    RAISE EXCEPTION 'contract is not available for signing';
  END IF;
  IF _c.documento_hash IS DISTINCT FROM lower(btrim(COALESCE(p_hash_visto, ''))) THEN
    RAISE EXCEPTION 'o documento mudou: abra o link de novo';
  END IF;
  IF p_assinado_em IS NULL OR abs(extract(epoch FROM (now() - p_assinado_em))) > 600 THEN
    RAISE EXCEPTION 'horário de assinatura fora do intervalo';
  END IF;
  IF p_pdf_path IS NULL
    OR position('..' IN p_pdf_path) > 0
    OR left(p_pdf_path, length('contracts/' || _c.client_id::text || '/')) <> 'contracts/' || _c.client_id::text || '/' THEN
    RAISE EXCEPTION 'caminho do PDF assinado inválido';
  END IF;
  IF NULLIF(btrim(p_pdf_nome), '') IS NULL OR COALESCE(p_pdf_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PDF assinado sem nome ou sem hash';
  END IF;

  UPDATE public.contracts
     SET client_signature_name = _nome,
         client_signature_email = _email,
         client_signature_ip = COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'),
         client_signature_user_agent = left(COALESCE(p_user_agent, ''), 400),
         client_signed_at = p_assinado_em,
         status = 'completed',
         original_file_url = 'files://' || p_pdf_path,
         original_file_name = left(btrim(p_pdf_nome), 200),
         pdf_final_hash = p_pdf_hash
   WHERE id = _c.id;

  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe, ip, user_agent)
  VALUES (_c.id, _c.client_id, 'assinado_cliente', 'Assinado por ' || _nome || ' (' || _email || ').',
    jsonb_build_object('documento_hash', _c.documento_hash), COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), left(COALESCE(p_user_agent, ''), 400));

  -- O registro em Arquivos e o evento contract_signed (que avisa a equipe) são os de sempre.
  _file := public.complete_contract_signature(p_token, _nome, p_ip);

  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe)
  VALUES (_c.id, _c.client_id, 'concluido',
    'Contrato ' || COALESCE(_c.numero, '') || ' versão ' || _c.versao || ' assinado pelas duas partes. PDF final em Arquivos > Contratos.',
    jsonb_build_object(
      'file_id', _file,
      'documento_hash', _c.documento_hash,
      'pdf_final_hash', p_pdf_hash,
      'assinado_agencia_em', _c.admin_signed_at,
      'assinado_cliente_em', p_assinado_em
    ));

  RETURN _file;
END
$$;

REVOKE ALL ON FUNCTION public.contrato_concluir_assinatura(text, text, text, text, text, text, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_concluir_assinatura(text, text, text, text, text, text, timestamptz, text, text, text) TO service_role;
