-- Central de Skills (18/11/2026): um catálogo único das skills de todos os
-- agentes (Claude Code, Codex, Hermes, plugins e as da casa), com o pacote
-- completo de cada uma no Storage, o histórico de versões, os conectores
-- (plugins, MCP, Composio) e as máquinas que sincronizam.
--
-- Leitura: equipe (RLS). Escrita: só a função central-skills (service_role),
-- que confere a chave MCP ou a sessão de admin/gestor. Idempotente.

CREATE TABLE IF NOT EXISTS public.central_skills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  nome          text NOT NULL,
  descricao     text NOT NULL DEFAULT '',
  categoria     text NOT NULL DEFAULT 'outros',
  tags          text[] NOT NULL DEFAULT '{}',
  -- Onde a skill foi encontrada: [{runtime, caminho, perfil?, maquina?}]
  origens       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Em quais agentes ela é instalada (claude, codex, hermes, agents).
  runtimes      text[] NOT NULL DEFAULT ARRAY['claude','codex','hermes','agents'],
  -- Skill que vem de plugin do Claude (ex.: claude-ads): no Claude entra pelo plugin.
  plugin        text,
  hash          text NOT NULL,
  versao        integer NOT NULL DEFAULT 1,
  tamanho_bytes bigint NOT NULL DEFAULT 0,
  arquivos      integer NOT NULL DEFAULT 0,
  skill_md      text NOT NULL DEFAULT '',
  pacote_path   text,
  status        text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','arquivada')),
  publicado_por text NOT NULL DEFAULT '',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS central_skills_categoria_idx ON public.central_skills (categoria);
CREATE INDEX IF NOT EXISTS central_skills_status_idx ON public.central_skills (status);

CREATE TABLE IF NOT EXISTS public.central_skill_versoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id      uuid NOT NULL REFERENCES public.central_skills(id) ON DELETE CASCADE,
  versao        integer NOT NULL,
  hash          text NOT NULL,
  pacote_path   text,
  skill_md      text NOT NULL DEFAULT '',
  publicado_por text NOT NULL DEFAULT '',
  origem        jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, versao)
);

CREATE TABLE IF NOT EXISTS public.central_conectores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._:@-]{0,119}$'),
  tipo          text NOT NULL CHECK (tipo IN ('plugin','mcp','composio')),
  nome          text NOT NULL,
  descricao     text NOT NULL DEFAULT '',
  -- Como instalar em cada agente: {claude: "...", codex: "...", hermes: "..."}
  instalar      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Nomes das variáveis de ambiente que o conector precisa (nunca o valor).
  requer        text[] NOT NULL DEFAULT '{}',
  skills        text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','arquivado')),
  publicado_por text NOT NULL DEFAULT '',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.central_maquinas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina       text NOT NULL,
  agente        text NOT NULL,
  versao_cliente text NOT NULL DEFAULT '',
  instaladas    integer NOT NULL DEFAULT 0,
  enviadas      integer NOT NULL DEFAULT 0,
  ultima_sync   timestamptz NOT NULL DEFAULT now(),
  detalhe       jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (maquina, agente)
);

ALTER TABLE public.central_skills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_skill_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_conectores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.central_maquinas      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS central_skills_equipe_le ON public.central_skills;
CREATE POLICY central_skills_equipe_le ON public.central_skills
  FOR SELECT TO authenticated USING (COALESCE(public.is_staff(auth.uid()), false));

DROP POLICY IF EXISTS central_skill_versoes_equipe_le ON public.central_skill_versoes;
CREATE POLICY central_skill_versoes_equipe_le ON public.central_skill_versoes
  FOR SELECT TO authenticated USING (COALESCE(public.is_staff(auth.uid()), false));

DROP POLICY IF EXISTS central_conectores_equipe_le ON public.central_conectores;
CREATE POLICY central_conectores_equipe_le ON public.central_conectores
  FOR SELECT TO authenticated USING (COALESCE(public.is_staff(auth.uid()), false));

DROP POLICY IF EXISTS central_maquinas_equipe_le ON public.central_maquinas;
CREATE POLICY central_maquinas_equipe_le ON public.central_maquinas
  FOR SELECT TO authenticated USING (COALESCE(public.is_staff(auth.uid()), false));

-- Pacotes (zip por versão) e o cliente de sincronização. Privado: só sai por
-- link assinado da função central-skills.
INSERT INTO storage.buckets (id, name, public)
VALUES ('central-skills', 'central-skills', false)
ON CONFLICT (id) DO UPDATE SET public = false;
