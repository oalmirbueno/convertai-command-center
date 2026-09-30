-- Frente BRF2 (30/09/2026): conselho de agentes mais completo.
--
-- 1. conselho_sessoes ganha o modo (rápido: 1 rodada de propostas e a síntese; padrão; profundo: as 4
--    rodadas com mais espaço), a pauta (itens e anexos com o trecho de texto de cada arquivo) e o PDF
--    da ata guardado em Arquivos.
-- 2. conselho_elencos: elencos salvos (quem entra, o modelo de cada um, critérios, rodadas e modo),
--    da agência inteira (client_id nulo) ou de um cliente. Arquivar em vez de apagar.
--
-- RLS: a equipe lê (is_staff; elenco de cliente também pede can_access_client); só a service_role
-- escreve (tudo passa pela função conselho). Só amplia, idempotente.

-- ---------------------------------------------------------------------------
-- 1. conselho_sessoes: colunas novas
-- ---------------------------------------------------------------------------
ALTER TABLE public.conselho_sessoes ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'padrao';
ALTER TABLE public.conselho_sessoes ADD COLUMN IF NOT EXISTS pauta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.conselho_sessoes ADD COLUMN IF NOT EXISTS ata_file_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conselho_sessoes_modo_check') THEN
    ALTER TABLE public.conselho_sessoes ADD CONSTRAINT conselho_sessoes_modo_check CHECK (modo IN ('rapido', 'padrao', 'profundo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conselho_sessoes_pauta_objeto') THEN
    ALTER TABLE public.conselho_sessoes ADD CONSTRAINT conselho_sessoes_pauta_objeto CHECK (jsonb_typeof(pauta) = 'object' AND pg_column_size(pauta) <= 65536);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conselho_sessoes_ata_file_fk') THEN
    ALTER TABLE public.conselho_sessoes
      ADD CONSTRAINT conselho_sessoes_ata_file_fk FOREIGN KEY (ata_file_id) REFERENCES public.files (id) ON DELETE SET NULL;
  END IF;
END
$migration$;

-- ---------------------------------------------------------------------------
-- 2. conselho_elencos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conselho_elencos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  preset text CHECK (preset IS NULL OR preset IN ('marca', 'campanha', 'proposta', 'site', 'crise')),
  especialistas jsonb NOT NULL CHECK (jsonb_typeof(especialistas) = 'array'),
  modelos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(modelos) = 'object'),
  criterios jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(criterios) = 'array'),
  rodadas smallint NOT NULL DEFAULT 4 CHECK (rodadas BETWEEN 2 AND 4),
  modo text NOT NULL DEFAULT 'padrao' CHECK (modo IN ('rapido', 'padrao', 'profundo')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz
);

CREATE INDEX IF NOT EXISTS conselho_elencos_cliente_idx ON public.conselho_elencos (client_id, criado_em DESC) WHERE arquivado_em IS NULL;

ALTER TABLE public.conselho_elencos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conselho_elencos_equipe_le ON public.conselho_elencos;
CREATE POLICY conselho_elencos_equipe_le ON public.conselho_elencos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

REVOKE ALL ON public.conselho_elencos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conselho_elencos TO authenticated;
GRANT ALL ON public.conselho_elencos TO service_role;

COMMENT ON TABLE public.conselho_elencos IS
  'Frente BRF2 (30/09/2026): elencos salvos do conselho de agentes. Escrita só pela função conselho.';

-- Conferência (só leitura, depois de aplicar):
--   select column_name from information_schema.columns where table_name = 'conselho_sessoes' and column_name in ('modo','pauta','ata_file_id');
--   select has_table_privilege('authenticated', 'public.conselho_elencos', 'INSERT');  -- false
