-- Frente BAS (29/09/2026): dados da agência para contratos, propostas e documentos.
--
-- Só amplia e é idempotente. Nada muda em can_access_client nem nas guardas de arquivo; nada é apagado.
--
-- 1. agencia_dados: uma linha só (id = true). Nasce VAZIA: nenhum dado inventado. Contrato e proposta
--    não geram enquanto faltar o que cada um pede (faltasNosDados em
--    supabase/functions/_shared/dados-da-agencia.ts, a mesma regra na tela em src/lib/agencia/dadosDaAgencia.ts).
--    Leitura: equipe (is_staff). Escrita: só admin (sem INSERT nem DELETE pela API: a linha já existe).
-- 2. Logo no Storage, bucket mesa, pasta agencia/ (fora da pasta de cliente): a equipe lê, só o admin envia.
--    Nada de apagar nem de sobrescrever: logo nova é arquivo novo e a linha aponta para ele.
-- 3. agencia_dados_sugestoes(): o que o banco já prova sobre a agência, para a tela mostrar como sugestão
--    (nunca grava). Evidência lida em 29/09 (SELECT): commercial_organizations tem a organização
--    "Aceleriq" (demais campos vazios) e financial_settings.owner_name = "Almir". Não há CNPJ, endereço,
--    comarca, Pix nem conta no banco.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agencia_dados (
  id boolean PRIMARY KEY DEFAULT true CONSTRAINT agencia_dados_uma_linha CHECK (id),
  razao_social text,
  nome_fantasia text,
  cnpj text,
  endereco text,
  cidade text,
  uf text,
  comarca text,
  representante_nome text,
  representante_cpf text,
  email text,
  telefone text,
  site text,
  instagram text,
  pix_chave text,
  dados_bancarios text,
  logo_bucket text NOT NULL DEFAULT 'mesa',
  logo_path text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencia_dados_uf_check') THEN
    ALTER TABLE public.agencia_dados
      ADD CONSTRAINT agencia_dados_uf_check CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencia_dados_cnpj_check') THEN
    ALTER TABLE public.agencia_dados
      ADD CONSTRAINT agencia_dados_cnpj_check CHECK (cnpj IS NULL OR regexp_replace(cnpj, '[^0-9]', '', 'g') ~ '^[0-9]{14}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencia_dados_cpf_check') THEN
    ALTER TABLE public.agencia_dados
      ADD CONSTRAINT agencia_dados_cpf_check CHECK (representante_cpf IS NULL OR regexp_replace(representante_cpf, '[^0-9]', '', 'g') ~ '^[0-9]{11}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agencia_dados_logo_check') THEN
    ALTER TABLE public.agencia_dados
      ADD CONSTRAINT agencia_dados_logo_check CHECK (
        logo_bucket = 'mesa'
        AND (logo_path IS NULL OR (logo_path LIKE 'agencia/%' AND position('..' in logo_path) = 0))
      );
  END IF;
END
$migration$;

-- A linha única, vazia.
INSERT INTO public.agencia_dados (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Quem mexeu e quando: pelo servidor, não pela tela.
CREATE OR REPLACE FUNCTION public.agencia_dados_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  NEW.id := true;
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agencia_dados_carimbo ON public.agencia_dados;
CREATE TRIGGER agencia_dados_carimbo
BEFORE UPDATE ON public.agencia_dados
FOR EACH ROW EXECUTE FUNCTION public.agencia_dados_carimbo();

ALTER TABLE public.agencia_dados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agencia_dados FROM PUBLIC, anon;
REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.agencia_dados FROM authenticated;
GRANT SELECT, UPDATE ON TABLE public.agencia_dados TO authenticated;
GRANT ALL ON TABLE public.agencia_dados TO service_role;

DROP POLICY IF EXISTS agencia_dados_equipe_le ON public.agencia_dados;
CREATE POLICY agencia_dados_equipe_le
ON public.agencia_dados
FOR SELECT TO authenticated
USING (COALESCE(public.is_staff((select auth.uid())), false));

DROP POLICY IF EXISTS agencia_dados_admin_altera ON public.agencia_dados;
CREATE POLICY agencia_dados_admin_altera
ON public.agencia_dados
FOR UPDATE TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------
-- 2. Logo no Storage (bucket mesa, pasta agencia/)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "mesa: equipe le a agencia" ON storage.objects;
CREATE POLICY "mesa: equipe le a agencia" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'mesa'
  AND (storage.foldername(name))[1] = 'agencia'
  AND COALESCE(public.is_staff((select auth.uid())), false)
);

DROP POLICY IF EXISTS "mesa: admin envia a agencia" ON storage.objects;
CREATE POLICY "mesa: admin envia a agencia" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'mesa'
  AND (storage.foldername(name))[1] = 'agencia'
  AND public.has_role((select auth.uid()), 'admin'::public.app_role)
);

-- ---------------------------------------------------------------------------
-- 3. Sugestões provadas pelo banco (só leitura, só equipe)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agencia_dados_sugestoes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _saida jsonb := '[]'::jsonb;
  _org record;
  _dono text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'Sem permissão para ver os dados da agência.' USING ERRCODE = '42501';
  END IF;

  SELECT o.name, o.cnpj, o.address, o.city, o.phone, o.site, o.instagram
    INTO _org
    FROM public.commercial_organizations AS o
   WHERE o.archived_at IS NULL
     AND lower(btrim(o.name)) = 'aceleriq'
   ORDER BY o.created_at
   LIMIT 1;

  IF FOUND THEN
    IF nullif(btrim(_org.name), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'nome_fantasia', 'valor', btrim(_org.name), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.cnpj), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'cnpj', 'valor', btrim(_org.cnpj), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.address), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'endereco', 'valor', btrim(_org.address), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.city), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'cidade', 'valor', btrim(_org.city), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.phone), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'telefone', 'valor', btrim(_org.phone), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.site), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'site', 'valor', btrim(_org.site), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
    IF nullif(btrim(_org.instagram), '') IS NOT NULL THEN
      _saida := _saida || jsonb_build_object('campo', 'instagram', 'valor', btrim(_org.instagram), 'fonte', 'Comercial: organização Aceleriq');
    END IF;
  END IF;

  SELECT nullif(btrim(f.owner_name), '')
    INTO _dono
    FROM public.financial_settings AS f
   WHERE f.settings_key = 'default'
   LIMIT 1;

  IF _dono IS NOT NULL THEN
    _saida := _saida || jsonb_build_object('campo', 'representante_nome', 'valor', _dono, 'fonte', 'Financeiro: nome do dono');
  END IF;

  RETURN _saida;
END;
$$;

REVOKE ALL ON FUNCTION public.agencia_dados_sugestoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agencia_dados_sugestoes() TO authenticated, service_role;
