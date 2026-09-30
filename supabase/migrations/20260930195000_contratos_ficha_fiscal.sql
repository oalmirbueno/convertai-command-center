-- Ficha fiscal do cliente e cache da consulta pública de CNPJ (frente CON2, 30/09/2026).
--
-- 1) cliente_dados_fiscais: CNPJ ou CPF, razão social, endereço,
--    representante e e-mails de contrato e de cobrança, uma linha por
--    cliente. Todo contrato, aditivo e renovação do cliente reaproveita.
--    Leitura: equipe com acesso ao cliente (can_access_client). Escrita: só
--    a função contratos (service_role), depois de conferir can_manage_client.
-- 2) cnpj_consultas: cache da BrasilAPI (dados públicos da Receita), por
--    CNPJ, com a data da consulta. Só o servidor lê e grava.
-- Idempotente e só amplia. Não enfraquece RLS nem can_access_client.

CREATE TABLE IF NOT EXISTS public.cliente_dados_fiscais (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo_pessoa text,
  documento text,
  razao_social text,
  nome_fantasia text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  representante_nome text,
  representante_cpf text,
  representante_cargo text,
  email_contrato text,
  email_cobranca text,
  telefone text,
  situacao_cadastral text,
  fonte text NOT NULL DEFAULT 'manual',
  consultado_em timestamptz,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_dados_fiscais_tipo_check CHECK (tipo_pessoa IS NULL OR tipo_pessoa IN ('pf', 'mei', 'pj')),
  CONSTRAINT cliente_dados_fiscais_documento_check CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9]{14})$'),
  CONSTRAINT cliente_dados_fiscais_cpf_check CHECK (representante_cpf IS NULL OR representante_cpf ~ '^[0-9]{11}$'),
  CONSTRAINT cliente_dados_fiscais_uf_check CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  CONSTRAINT cliente_dados_fiscais_cep_check CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$'),
  CONSTRAINT cliente_dados_fiscais_fonte_check CHECK (fonte IN ('manual', 'brasilapi', 'agente'))
);

CREATE INDEX IF NOT EXISTS cliente_dados_fiscais_documento_idx ON public.cliente_dados_fiscais (documento) WHERE documento IS NOT NULL;

ALTER TABLE public.cliente_dados_fiscais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cliente_dados_fiscais FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_dados_fiscais TO authenticated;
GRANT ALL ON public.cliente_dados_fiscais TO service_role;

DROP POLICY IF EXISTS cliente_dados_fiscais_equipe_le ON public.cliente_dados_fiscais;
CREATE POLICY cliente_dados_fiscais_equipe_le ON public.cliente_dados_fiscais
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

COMMENT ON TABLE public.cliente_dados_fiscais IS 'Ficha fiscal do cliente (CNPJ/CPF, razão social, endereço, representante, e-mails de contrato e cobrança). Reaproveitada nos contratos. Escrita só pela função contratos. Frente CON2, 30/09/2026.';

CREATE TABLE IF NOT EXISTS public.cnpj_consultas (
  cnpj text PRIMARY KEY,
  resposta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status integer NOT NULL DEFAULT 200,
  consultado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cnpj_consultas_cnpj_check CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cnpj_consultas_resposta_check CHECK (jsonb_typeof(resposta) = 'object')
);

ALTER TABLE public.cnpj_consultas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cnpj_consultas FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cnpj_consultas TO service_role;

COMMENT ON TABLE public.cnpj_consultas IS 'Cache da consulta pública de CNPJ (BrasilAPI). Só o servidor lê e grava. Frente CON2, 30/09/2026.';

-- Conferência (só leitura, depois de aplicar):
-- select to_regclass('public.cliente_dados_fiscais') is not null as ficha_ok,
--        to_regclass('public.cnpj_consultas') is not null as cache_ok,
--        (select count(*) from pg_policies where tablename = 'cliente_dados_fiscais') as politicas; -- 1
