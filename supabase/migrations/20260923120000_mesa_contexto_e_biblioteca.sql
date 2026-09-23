-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE: CONTEXTO AUTOMÁTICO, BIBLIOTECA DE FONTES E BANCO DE
-- REFERÊNCIAS GLOBAIS.
--
-- O relato do dono (23/09): a Mesa não puxava o que o cliente já tem. A
-- Mirante Luz tinha 148 criativos aprovados, 3 documentos mestres de
-- identidade com o texto extraído e uma pasta "Referências de Design" no
-- workspace, e a Mesa gerou a arte com kit vazio, sem fonte e sem
-- referência: saiu genérica.
--
-- O que muda (só acrescenta):
--   · referências do cliente podem vir de um arquivo já entregue (origem
--     'arquivo', ligada ao files.id): as artes aprovadas viram referência
--     de identidade;
--   · o kit ganha o contexto consolidado (o que o agente de contexto leu:
--     negócio, público, tom, tipografia citada nos documentos, fontes lidas);
--   · fontes do cliente podem vir da biblioteca global da agência;
--   · biblioteca global de fontes e banco global de referências de
--     composição (curadoria da agência), lidos por toda a equipe;
--   · o agente de contexto ganha nome próprio em conversas e usos.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Referência a partir de arquivo já entregue ──────────────────────

ALTER TABLE public.cliente_referencias
  DROP CONSTRAINT cliente_referencias_origem_check;
ALTER TABLE public.cliente_referencias
  ADD CONSTRAINT cliente_referencias_origem_check
  CHECK (origem IN ('workspace', 'pinterest', 'upload', 'arquivo'));

ALTER TABLE public.cliente_referencias
  ADD COLUMN file_id uuid,
  -- identidade: arte do próprio cliente (mostra a marca); tecnica: peça de
  -- outra marca que ensina composição.
  ADD COLUMN papel text NOT NULL DEFAULT 'tecnica' CHECK (papel IN ('identidade', 'tecnica'));

CREATE UNIQUE INDEX cliente_referencias_arquivo_unico
  ON public.cliente_referencias (client_id, file_id)
  WHERE file_id IS NOT NULL;

-- ─── 2) Contexto consolidado no kit ─────────────────────────────────────

ALTER TABLE public.cliente_kit_marca
  ADD COLUMN contexto jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(contexto) = 'object'),
  ADD COLUMN contexto_atualizado_em timestamptz;

-- ─── 3) Biblioteca global de fontes ─────────────────────────────────────

CREATE TABLE public.fontes_biblioteca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  familia text NOT NULL,
  slug text NOT NULL UNIQUE,
  categoria text,
  personalidade text[] NOT NULL DEFAULT '{}',
  usos text[] NOT NULL DEFAULT '{}',
  nichos text[] NOT NULL DEFAULT '{}',
  pareamentos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pareamentos) = 'array'),
  licenca text,
  suporta_portugues boolean NOT NULL DEFAULT true,
  -- [{arquivo, estilo, peso, italico}] com caminho no bucket mesa (biblioteca/fontes/...)
  arquivos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(arquivos) = 'array'),
  amostra_path text,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cliente_fontes
  ADD COLUMN biblioteca_id uuid REFERENCES public.fontes_biblioteca(id) ON DELETE SET NULL,
  ADD COLUMN origem text NOT NULL DEFAULT 'upload' CHECK (origem IN ('upload', 'biblioteca', 'documento'));

-- ─── 4) Banco global de referências de composição ───────────────────────

CREATE TABLE public.referencias_globais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL CHECK (origem IN ('pinterest', 'curadoria')),
  url_origem text,
  storage_path text,
  titulo text,
  leitura text,
  tags text[] NOT NULL DEFAULT '{}',
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX referencias_globais_url_unica
  ON public.referencias_globais (url_origem)
  WHERE url_origem IS NOT NULL;

-- ─── 5) Agente de contexto ──────────────────────────────────────────────

ALTER TABLE public.agente_conversas DROP CONSTRAINT agente_conversas_agente_check;
ALTER TABLE public.agente_conversas
  ADD CONSTRAINT agente_conversas_agente_check
  CHECK (agente IN ('estrategista', 'diretor_arte', 'contexto'));

ALTER TABLE public.ia_usos DROP CONSTRAINT ia_usos_agente_check;
ALTER TABLE public.ia_usos
  ADD CONSTRAINT ia_usos_agente_check
  CHECK (agente IN ('estrategista', 'diretor_arte', 'gerador_imagem', 'leitor', 'jev', 'contexto'));

ALTER TABLE public.ia_usos DROP CONSTRAINT ia_usos_tarefa_check;
ALTER TABLE public.ia_usos
  ADD CONSTRAINT ia_usos_tarefa_check
  CHECK (tarefa IN ('calendario', 'estudio', 'conversa', 'leitura_referencia', 'verificacao', 'contexto'));

-- ─── 6) RLS das tabelas globais ─────────────────────────────────────────

ALTER TABLE public.fontes_biblioteca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referencias_globais ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fontes_biblioteca, public.referencias_globais
  FROM PUBLIC, anon, authenticated, service_role;

CREATE POLICY fontes_biblioteca_equipe_le ON public.fontes_biblioteca
FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
CREATE POLICY fontes_biblioteca_admin_escreve ON public.fontes_biblioteca
FOR ALL TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

CREATE POLICY referencias_globais_equipe_le ON public.referencias_globais
FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
CREATE POLICY referencias_globais_admin_escreve ON public.referencias_globais
FOR ALL TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role))
WITH CHECK (public.has_role((select auth.uid()), 'admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fontes_biblioteca, public.referencias_globais TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fontes_biblioteca, public.referencias_globais TO service_role;

-- ─── 7) Aviso certo no agendamento da Mesa ──────────────────────────────
--
-- O ciclo de publicação (editorial_ciclo_publicacao, todo minuto) publica
-- também as publicações em modo manual: é assim que Terra Flor, Acerbi e os
-- outros já saem sozinhos. O aviso "a conta não publica sozinha" gravado pela
-- Mesa estava errado e sai.
DO $patch$
DECLARE
  _fonte text;
  _alvo text := 'entrega_aviso = CASE WHEN _modo = ''manual''
                 THEN ''Agendado. A conta não publica sozinha: no horário, a equipe publica pela Agenda.''
                 ELSE NULL END';
BEGIN
  SELECT pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure) INTO _fonte;
  IF position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch mesa_agendar_aprovados: alvo nao encontrado';
  END IF;
  EXECUTE replace(_fonte, _alvo, 'entrega_aviso = NULL');
END
$patch$;
