-- Prova reproduzível, num banco VAZIO, de que dossie_registrar_avancos_interno
-- preserva "Conversas do grupo de WhatsApp" em duas passagens.
--
-- Não aplicar em produção. Recusa o banco se o upsert real já existir.
-- Uso:
--   createdb dossie_whatsapp_teste
--   psql -v ON_ERROR_STOP=1 -d dossie_whatsapp_teste -f supabase/tests/dossie_preserva_conversas_whatsapp.sql
--
-- O n8n não está neste arquivo: o teste só deixa a seção depois do marcador,
-- que é o estado que a rotina encontrava.

DO $$
BEGIN
  IF to_regprocedure('public.upsert_current_dossier(uuid,text,text,uuid,text,text,text,text,text[],jsonb,text,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'teste recusado: este banco já tem upsert_current_dossier; use um banco vazio';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app_private;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.client_dossiers (
  id uuid PRIMARY KEY DEFAULT 'd0551e00-0000-4000-8000-000000000010',
  client_id uuid NOT NULL,
  project_id uuid,
  dossier_type text NOT NULL,
  version integer NOT NULL,
  content text,
  summary text,
  change_reason text,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_private.dossie_versao_automatica(_change_reason text, _tags text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT coalesce(_change_reason, '') = 'Movimentos automáticos do painel (14 dias)'
    AND 'avancos-automaticos' = any(coalesce(_tags, array[]::text[]));
$$;

CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 14)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT E'## Avanços recentes (automático, 10/11/2026)\nRegistro novo da rotina.';
$$;

CREATE OR REPLACE FUNCTION public.upsert_current_dossier(
  _client_id uuid,
  _content text,
  _dossier_type text DEFAULT 'contexto',
  _project_id uuid DEFAULT NULL,
  _summary text DEFAULT NULL,
  _change_reason text DEFAULT NULL,
  _source text DEFAULT NULL,
  _actor text DEFAULT NULL,
  _tags text[] DEFAULT '{}',
  _metadata jsonb DEFAULT '{}'::jsonb,
  _correlation_id text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _expected_version integer DEFAULT NULL
)
RETURNS public.client_dossiers
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _atual public.client_dossiers%rowtype;
  _novo public.client_dossiers%rowtype;
BEGIN
  SELECT * INTO _atual FROM public.client_dossiers
   WHERE client_id = _client_id AND dossier_type = _dossier_type AND project_id IS NULL AND is_current
   FOR UPDATE;
  IF _expected_version IS NOT NULL AND coalesce(_atual.version, 0) <> _expected_version THEN
    RAISE EXCEPTION 'version_conflict';
  END IF;
  IF _atual.id IS NOT NULL THEN
    UPDATE public.client_dossiers SET is_current = false WHERE id = _atual.id;
  END IF;
  INSERT INTO public.client_dossiers (
    id, client_id, project_id, dossier_type, version, content, summary,
    change_reason, tags, metadata, is_current, created_at
  ) VALUES (
    gen_random_uuid(), _client_id, _project_id, _dossier_type,
    coalesce(_atual.version, 0) + 1, _content, _summary, _change_reason,
    coalesce(_tags, '{}'), coalesce(_metadata, '{}'::jsonb), true, now()
  ) RETURNING * INTO _novo;
  RETURN _novo;
END;
$$;

\ir ../migrations/20261110120000_dossie_preserva_conversas_whatsapp.sql

INSERT INTO public.client_dossiers (id, client_id, dossier_type, project_id, version, content, is_current, summary)
VALUES (
  'd0551e00-0000-4000-8000-000000000010',
  'd0551e00-0000-4000-8000-000000000001',
  'contexto',
  NULL,
  1,
  E'# Contexto operacional — SKC\n## 1. Plano\nPoda e jardins.\n\n## Leitura da Central (agente, 01/11/2026)\n**Onde estamos:** campanha no ar.\n\n## Confirmado pelo dono (agente da Central)\n- 01/11/2026 · Verba de 30 por dia.\n\n## Avanços recentes (automático, 09/11/2026)\nRegistro velho.\n\n## Conversas do grupo de WhatsApp\n- Cliente pediu orçamento da poda.',
  true,
  'resumo'
);

DO $$
DECLARE
  _id constant uuid := 'd0551e00-0000-4000-8000-000000000001';
  _passagem boolean;
  _texto text;
  _versoes integer;
  _copias integer;
BEGIN
  _passagem := public.dossie_registrar_avancos_interno(_id);
  IF _passagem IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'primeira passagem deveria gravar, devolveu %', _passagem;
  END IF;
  SELECT content, (length(content) - length(replace(content, '## Conversas do grupo de WhatsApp', ''))) / length('## Conversas do grupo de WhatsApp')
    INTO _texto, _copias
    FROM public.client_dossiers WHERE client_id = _id AND is_current;
  IF _copias IS DISTINCT FROM 1
     OR position('## Conversas do grupo de WhatsApp' IN _texto) = 0
     OR position('## Conversas do grupo de WhatsApp' IN _texto) > position('## Avanços recentes (automático' IN _texto)
     OR position('- Cliente pediu orçamento da poda.' IN _texto) = 0
     OR position('## 1. Plano' IN _texto) = 0
     OR position('Verba de 30 por dia.' IN _texto) = 0
     OR position('Registro velho.' IN _texto) > 0
     OR position('Registro novo da rotina.' IN _texto) = 0 THEN
    RAISE EXCEPTION 'primeira passagem perdeu ou duplicou a conversa: %', _texto;
  END IF;

  _passagem := public.dossie_registrar_avancos_interno(_id);
  IF _passagem IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'segunda passagem deveria ser estável, devolveu %', _passagem;
  END IF;
  SELECT count(*)::int INTO _versoes FROM public.client_dossiers WHERE client_id = _id;
  IF _versoes IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'duas passagens criaram % versões', _versoes;
  END IF;
  IF (SELECT content FROM public.client_dossiers WHERE client_id = _id AND is_current) IS DISTINCT FROM _texto THEN
    RAISE EXCEPTION 'segunda passagem alterou o texto';
  END IF;

  UPDATE public.client_dossiers
     SET content = content || E'\n\n## Conversas do grupo de WhatsApp\n- Mensagem nova das 20:30.'
   WHERE client_id = _id AND is_current;
  _passagem := public.dossie_registrar_avancos_interno(_id);
  IF _passagem IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'a cauda do mesmo dia deveria ser recolhida, devolveu %', _passagem;
  END IF;
  SELECT content,
         (length(content) - length(replace(content, '## Conversas do grupo de WhatsApp', ''))) / length('## Conversas do grupo de WhatsApp')
    INTO _texto, _copias
    FROM public.client_dossiers WHERE client_id = _id AND is_current;
  IF _copias IS DISTINCT FROM 1
     OR position('- Mensagem nova das 20:30.' IN _texto) = 0
     OR position('orçamento da poda.' IN _texto) > 0
     OR position('## Conversas do grupo de WhatsApp' IN _texto) > position('## Avanços recentes (automático' IN _texto)
     OR position('## 1. Plano' IN _texto) = 0 THEN
    RAISE EXCEPTION 'recolha da cauda ficou errada: %', _texto;
  END IF;

  _passagem := public.dossie_registrar_avancos_interno(_id);
  IF _passagem IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'passagem depois da recolha deveria ser estável, devolveu %', _passagem;
  END IF;
  RAISE NOTICE 'ok: WhatsApp preservado em duas passagens e na recolha do mesmo dia';
END $$;
