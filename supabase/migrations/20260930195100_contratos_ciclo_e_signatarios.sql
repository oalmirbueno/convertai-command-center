-- Ciclo do contrato, mais de um signatário e editor de modelos (frente CON2, 30/09/2026).
--
-- 1) contracts ganha o tipo do documento (contrato, aditivo, renovação), o
--    contrato-mãe do aditivo, o contrato renovado, a vigência calculada no
--    congelamento e as marcas do lembrete e do aviso de vencimento. Tudo pela
--    função contratos (contracts_modelo_guard já barra a tela no contrato de
--    modelo). Uma renovação viva por contrato.
-- 2) contrato_signatarios: quem assina pelo contratante (um ou mais) e as
--    testemunhas, cada um com o próprio link. O primeiro do contratante é o
--    principal e usa o sign_token de sempre. Depois de congelado, a lista não
--    muda; só a assinatura de cada um entra, uma vez, pela RPC.
--    - contrato_assinar_signatario: confere o hash que a pessoa viu e o
--      e-mail cadastrado; devolve quantas assinaturas faltam;
--    - contrato_concluir_com_signatarios: com todas as obrigatórias, fecha o
--      contrato (PDF final em Arquivos pelo complete_contract_signature de
--      sempre, que avisa a equipe).
-- 3) contrato_modelo_publicar: o editor de modelos publica a versão N+1 e
--    desliga a anterior no mesmo passo (versão publicada nunca muda).
-- 4) contrato_preferencias: o que o dono liga ou desliga (cláusulas extras
--    padrão, dias do aviso de vencimento e do lembrete de assinatura).
-- 5) Amplia as CHECKs: tipos de modelo (extras, aditivo) e eventos novos.
-- Idempotente e só amplia. Não enfraquece RLS nem can_access_client.

-- --------------------------------------------------------------- contracts
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'contrato',
  ADD COLUMN IF NOT EXISTS contrato_mae_id uuid,
  ADD COLUMN IF NOT EXISTS renovacao_de uuid,
  ADD COLUMN IF NOT EXISTS vigencia_inicio date,
  ADD COLUMN IF NOT EXISTS vigencia_fim date,
  ADD COLUMN IF NOT EXISTS lembrete_em timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_vencimento_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_tipo_documento_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_tipo_documento_check CHECK (tipo_documento IN ('contrato', 'aditivo', 'renovacao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_aditivo_tem_mae_check') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_aditivo_tem_mae_check CHECK (tipo_documento <> 'aditivo' OR contrato_mae_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_contrato_mae_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_contrato_mae_fkey FOREIGN KEY (contrato_mae_id) REFERENCES public.contracts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_renovacao_de_fkey') THEN
    ALTER TABLE public.contracts ADD CONSTRAINT contracts_renovacao_de_fkey FOREIGN KEY (renovacao_de) REFERENCES public.contracts(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS contracts_contrato_mae_idx ON public.contracts (contrato_mae_id) WHERE contrato_mae_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_vigencia_fim_idx ON public.contracts (vigencia_fim) WHERE vigencia_fim IS NOT NULL AND status = 'completed';
-- Uma renovação viva por contrato (as versões novas da renovação apontam para ela, não para o contrato).
CREATE UNIQUE INDEX IF NOT EXISTS contracts_uma_renovacao_idx
  ON public.contracts (renovacao_de)
  WHERE renovacao_de IS NOT NULL AND versao_de IS NULL AND status <> 'cancelled';

COMMENT ON COLUMN public.contracts.tipo_documento IS 'contrato, aditivo (muda escopo, valor ou vigência do contrato_mae_id) ou renovacao (renova o renovacao_de). Frente CON2.';
COMMENT ON COLUMN public.contracts.vigencia_fim IS 'Fim da vigência calculado no congelamento (início + meses dos serviços mensais). Base do aviso de vencimento.';

-- --------------------------------------------------------------- CHECKs ampliadas
ALTER TABLE public.contrato_modelos DROP CONSTRAINT IF EXISTS contrato_modelos_tipo_check;
ALTER TABLE public.contrato_modelos ADD CONSTRAINT contrato_modelos_tipo_check CHECK (tipo IN ('condicoes_gerais', 'bloco', 'extras', 'aditivo'));
ALTER TABLE public.contrato_modelos DROP CONSTRAINT IF EXISTS contrato_modelos_servico_check;
ALTER TABLE public.contrato_modelos ADD CONSTRAINT contrato_modelos_servico_check CHECK (
  (tipo IN ('condicoes_gerais', 'extras', 'aditivo') AND servico IS NULL)
  OR (tipo = 'bloco' AND servico IN ('social', 'site', 'marca', 'naming', 'trafego', 'video', 'design', 'mensalista'))
);

ALTER TABLE public.contrato_eventos DROP CONSTRAINT IF EXISTS contrato_eventos_tipo_check;
ALTER TABLE public.contrato_eventos ADD CONSTRAINT contrato_eventos_tipo_check CHECK (tipo IN (
  'criado', 'gerado_do_aceite', 'servicos_mudaram', 'variaveis_salvas',
  'clausula_alterada', 'clausula_restaurada', 'congelado', 'assinado_agencia',
  'enviado_email', 'mensagem_copiada', 'visualizado', 'assinado_cliente',
  'concluido', 'nova_versao', 'substituido', 'cancelado', 'arquivado',
  'gerado_do_cliente', 'aditivo_criado', 'renovacao_criada', 'aviso_vencimento',
  'lembrete_copiado', 'signatarios_salvos', 'assinado_signatario', 'ficha_aplicada', 'preenchido_ia'
));

-- --------------------------------------------------------------- preferências do dono
CREATE TABLE IF NOT EXISTS public.contrato_preferencias (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL DEFAULT '{}'::jsonb,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contrato_preferencias_chave_check CHECK (chave IN ('extras', 'avisos'))
);

ALTER TABLE public.contrato_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contrato_preferencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_preferencias TO authenticated;
GRANT ALL ON public.contrato_preferencias TO service_role;

DROP POLICY IF EXISTS contrato_preferencias_equipe_le ON public.contrato_preferencias;
CREATE POLICY contrato_preferencias_equipe_le ON public.contrato_preferencias
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())));

-- --------------------------------------------------------------- signatários
CREATE TABLE IF NOT EXISTS public.contrato_signatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel text NOT NULL,
  principal boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 1,
  nome text NOT NULL,
  email text NOT NULL,
  documento text,
  obrigatorio boolean NOT NULL DEFAULT true,
  token text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  assinado_em timestamptz,
  assinatura_nome text,
  assinatura_email text,
  assinatura_ip text,
  assinatura_user_agent text,
  hash_visto text,
  removido_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contrato_signatarios_papel_check CHECK (papel IN ('contratante', 'testemunha')),
  CONSTRAINT contrato_signatarios_nome_check CHECK (length(btrim(nome)) BETWEEN 3 AND 200),
  CONSTRAINT contrato_signatarios_email_check CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' AND length(email) <= 254),
  CONSTRAINT contrato_signatarios_documento_check CHECK (documento IS NULL OR documento ~ '^[0-9]{11}$'),
  CONSTRAINT contrato_signatarios_principal_check CHECK (NOT principal OR (papel = 'contratante' AND obrigatorio)),
  CONSTRAINT contrato_signatarios_token_check CHECK (length(token) >= 32)
);

CREATE UNIQUE INDEX IF NOT EXISTS contrato_signatarios_token_key ON public.contrato_signatarios (token);
CREATE UNIQUE INDEX IF NOT EXISTS contrato_signatarios_um_principal_idx ON public.contrato_signatarios (contract_id) WHERE principal AND removido_em IS NULL;
CREATE INDEX IF NOT EXISTS contrato_signatarios_contrato_idx ON public.contrato_signatarios (contract_id, ordem);

-- Depois de congelado: ninguém entra nem sai, e só a assinatura de cada um muda, uma vez.
CREATE OR REPLACE FUNCTION public.contrato_signatarios_guarda()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _congelado boolean;
BEGIN
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT c.congelado_em IS NOT NULL INTO _congelado FROM public.contracts AS c
   WHERE c.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.contract_id ELSE NEW.contract_id END;
  _congelado := COALESCE(_congelado, false);
  IF TG_OP = 'DELETE' THEN
    IF _congelado THEN RAISE EXCEPTION 'signatário de contrato congelado não sai: crie uma versão nova'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF _congelado THEN RAISE EXCEPTION 'contrato congelado não ganha signatário: crie uma versão nova'; END IF;
    IF NEW.assinado_em IS NOT NULL THEN RAISE EXCEPTION 'signatário novo nasce sem assinatura'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.contract_id IS DISTINCT FROM OLD.contract_id OR NEW.token IS DISTINCT FROM OLD.token OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'o signatário não muda de contrato nem de link';
  END IF;
  IF OLD.assinado_em IS NOT NULL AND (
    NEW.assinado_em IS DISTINCT FROM OLD.assinado_em OR NEW.assinatura_nome IS DISTINCT FROM OLD.assinatura_nome
    OR NEW.assinatura_email IS DISTINCT FROM OLD.assinatura_email OR NEW.hash_visto IS DISTINCT FROM OLD.hash_visto
  ) THEN
    RAISE EXCEPTION 'assinatura registrada não muda';
  END IF;
  IF _congelado AND (
    NEW.nome IS DISTINCT FROM OLD.nome OR NEW.email IS DISTINCT FROM OLD.email OR NEW.documento IS DISTINCT FROM OLD.documento
    OR NEW.papel IS DISTINCT FROM OLD.papel OR NEW.principal IS DISTINCT FROM OLD.principal OR NEW.obrigatorio IS DISTINCT FROM OLD.obrigatorio
    OR NEW.ordem IS DISTINCT FROM OLD.ordem OR NEW.removido_em IS DISTINCT FROM OLD.removido_em
  ) THEN
    RAISE EXCEPTION 'contrato congelado: a lista de quem assina não muda';
  END IF;
  IF NOT _congelado AND NEW.assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'só contrato congelado recebe assinatura';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.contrato_signatarios_guarda() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS contrato_signatarios_guarda_trg ON public.contrato_signatarios;
CREATE TRIGGER contrato_signatarios_guarda_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.contrato_signatarios
  FOR EACH ROW EXECUTE FUNCTION public.contrato_signatarios_guarda();

ALTER TABLE public.contrato_signatarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contrato_signatarios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_signatarios TO authenticated;
GRANT ALL ON public.contrato_signatarios TO service_role;

DROP POLICY IF EXISTS contrato_signatarios_equipe_le ON public.contrato_signatarios;
CREATE POLICY contrato_signatarios_equipe_le ON public.contrato_signatarios
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

-- --------------------------------------------------------------- assinatura de cada signatário
CREATE OR REPLACE FUNCTION public.contrato_assinar_signatario(
  p_token text,
  p_nome text,
  p_email text,
  p_ip text,
  p_user_agent text,
  p_hash_visto text,
  p_assinado_em timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s public.contrato_signatarios%ROWTYPE;
  _c public.contracts%ROWTYPE;
  _nome text := NULLIF(btrim(p_nome), '');
  _email text := lower(NULLIF(btrim(p_email), ''));
  _faltam integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'contract completion requires the trusted signing backend';
  END IF;
  IF NULLIF(btrim(p_token), '') IS NULL OR _nome IS NULL OR length(_nome) > 200 THEN
    RAISE EXCEPTION 'invalid contract signature input';
  END IF;
  SELECT * INTO _s FROM public.contrato_signatarios WHERE token = p_token AND removido_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'signatario not found'; END IF;
  SELECT * INTO _c FROM public.contracts WHERE id = _s.contract_id FOR UPDATE;
  IF _c.origem <> 'modelo' OR _c.status <> 'sent' OR _c.admin_signed_at IS NULL OR _c.client_signed_at IS NOT NULL OR _c.congelado_em IS NULL THEN
    RAISE EXCEPTION 'contract is not available for signing';
  END IF;
  IF _s.assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'esta pessoa já assinou';
  END IF;
  IF _email IS DISTINCT FROM lower(_s.email) THEN
    RAISE EXCEPTION 'use o e-mail cadastrado para esta assinatura';
  END IF;
  IF _c.documento_hash IS DISTINCT FROM lower(btrim(COALESCE(p_hash_visto, ''))) THEN
    RAISE EXCEPTION 'o documento mudou: abra o link de novo';
  END IF;
  IF p_assinado_em IS NULL OR abs(extract(epoch FROM (now() - p_assinado_em))) > 600 THEN
    RAISE EXCEPTION 'horário de assinatura fora do intervalo';
  END IF;

  UPDATE public.contrato_signatarios
     SET assinado_em = p_assinado_em,
         assinatura_nome = _nome,
         assinatura_email = _email,
         assinatura_ip = COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'),
         assinatura_user_agent = left(COALESCE(p_user_agent, ''), 400),
         hash_visto = _c.documento_hash
   WHERE id = _s.id;

  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe, ip, user_agent)
  VALUES (_c.id, _c.client_id, 'assinado_signatario',
    CASE WHEN _s.papel = 'testemunha' THEN 'Testemunha assinou: ' ELSE 'Assinado pelo contratante: ' END || _nome || ' (' || _email || ').',
    jsonb_build_object('signatario_id', _s.id, 'papel', _s.papel, 'documento_hash', _c.documento_hash),
    COALESCE(NULLIF(btrim(p_ip), ''), 'unknown'), left(COALESCE(p_user_agent, ''), 400));

  SELECT count(*) INTO _faltam FROM public.contrato_signatarios
   WHERE contract_id = _c.id AND removido_em IS NULL AND obrigatorio AND assinado_em IS NULL;

  RETURN jsonb_build_object('contract_id', _c.id, 'signatario_id', _s.id, 'papel', _s.papel, 'faltam', _faltam);
END
$$;

REVOKE ALL ON FUNCTION public.contrato_assinar_signatario(text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_assinar_signatario(text, text, text, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.contrato_concluir_com_signatarios(
  p_contract uuid,
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
  _p public.contrato_signatarios%ROWTYPE;
  _file uuid;
  _pessoas integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'contract completion requires the trusted signing backend';
  END IF;
  SELECT * INTO _c FROM public.contracts WHERE id = p_contract FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
  IF _c.origem <> 'modelo' OR _c.status <> 'sent' OR _c.client_signed_at IS NOT NULL OR _c.congelado_em IS NULL THEN
    RAISE EXCEPTION 'contract is not available for signing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.contrato_signatarios WHERE contract_id = _c.id AND removido_em IS NULL AND obrigatorio AND assinado_em IS NULL) THEN
    RAISE EXCEPTION 'faltam assinaturas';
  END IF;
  SELECT * INTO _p FROM public.contrato_signatarios WHERE contract_id = _c.id AND principal AND removido_em IS NULL;
  IF NOT FOUND OR _p.assinado_em IS NULL THEN
    RAISE EXCEPTION 'o signatário principal ainda não assinou';
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
     SET client_signature_name = _p.assinatura_nome,
         client_signature_email = _p.assinatura_email,
         client_signature_ip = COALESCE(_p.assinatura_ip, 'unknown'),
         client_signature_user_agent = _p.assinatura_user_agent,
         client_signed_at = _p.assinado_em,
         status = 'completed',
         original_file_url = 'files://' || p_pdf_path,
         original_file_name = left(btrim(p_pdf_nome), 200),
         pdf_final_hash = p_pdf_hash
   WHERE id = _c.id;

  -- O registro em Arquivos e o evento contract_signed (que avisa a equipe) são os de sempre.
  _file := public.complete_contract_signature(_c.sign_token, _p.assinatura_nome, COALESCE(_p.assinatura_ip, 'unknown'));

  SELECT count(*) INTO _pessoas FROM public.contrato_signatarios WHERE contract_id = _c.id AND removido_em IS NULL AND assinado_em IS NOT NULL;
  INSERT INTO public.contrato_eventos (contract_id, client_id, tipo, resumo, detalhe)
  VALUES (_c.id, _c.client_id, 'concluido',
    'Contrato ' || COALESCE(_c.numero, '') || ' versão ' || _c.versao || ' assinado por todos (' || _pessoas || ' pelo cliente e testemunhas). PDF final em Arquivos > Contratos.',
    jsonb_build_object('file_id', _file, 'documento_hash', _c.documento_hash, 'pdf_final_hash', p_pdf_hash, 'assinaturas', _pessoas));

  RETURN _file;
END
$$;

REVOKE ALL ON FUNCTION public.contrato_concluir_com_signatarios(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_concluir_com_signatarios(uuid, text, text, text) TO service_role;

-- --------------------------------------------------------------- editor de modelos: versão nova e desliga a anterior
CREATE OR REPLACE FUNCTION public.contrato_modelo_publicar(
  p_chave text,
  p_nome text,
  p_variaveis jsonb,
  p_clausulas jsonb,
  p_revisao text,
  p_ator uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _atual public.contrato_modelos%ROWTYPE;
  _versao integer;
  _novo uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'somente a função contratos publica modelos';
  END IF;
  IF jsonb_typeof(p_clausulas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_clausulas) = 0 THEN
    RAISE EXCEPTION 'o modelo precisa de pelo menos uma cláusula';
  END IF;
  IF jsonb_typeof(p_variaveis) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'variáveis inválidas';
  END IF;
  SELECT * INTO _atual FROM public.contrato_modelos WHERE chave = p_chave AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'modelo sem versão ativa'; END IF;
  SELECT COALESCE(max(versao), 0) + 1 INTO _versao FROM public.contrato_modelos WHERE chave = p_chave;

  UPDATE public.contrato_modelos SET ativo = false, revogado_em = now() WHERE id = _atual.id;

  INSERT INTO public.contrato_modelos (chave, tipo, servico, nome, versao, revisao_juridica, variaveis, ativo, criado_por)
  VALUES (_atual.chave, _atual.tipo, _atual.servico, COALESCE(NULLIF(btrim(p_nome), ''), _atual.nome), _versao,
    COALESCE(NULLIF(btrim(p_revisao), ''), 'v' || _versao || ' · revisão jurídica pendente'), p_variaveis, true, p_ator)
  RETURNING id INTO _novo;

  INSERT INTO public.contrato_clausulas (modelo_id, ordem, chave, titulo, texto, quando)
  SELECT _novo, x.ordem::integer, x.c->>'chave', x.c->>'titulo', x.c->>'texto',
         CASE WHEN jsonb_typeof(x.c->'quando') = 'object' THEN x.c->'quando' ELSE NULL END
    FROM jsonb_array_elements(p_clausulas) WITH ORDINALITY AS x(c, ordem);

  RETURN jsonb_build_object('id', _novo, 'chave', _atual.chave, 'versao', _versao, 'anterior', _atual.versao);
END
$$;

REVOKE ALL ON FUNCTION public.contrato_modelo_publicar(text, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contrato_modelo_publicar(text, text, jsonb, jsonb, text, uuid) TO service_role;

-- Conferência (só leitura, depois de aplicar):
-- select to_regclass('public.contrato_signatarios') is not null as signatarios_ok,
--        to_regclass('public.contrato_preferencias') is not null as preferencias_ok,
--        (select count(*) from information_schema.columns where table_name = 'contracts' and column_name in ('tipo_documento', 'contrato_mae_id', 'renovacao_de', 'vigencia_fim', 'lembrete_em', 'aviso_vencimento_em')) as colunas; -- 6
