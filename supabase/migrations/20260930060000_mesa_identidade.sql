-- Frente IDV (30/09/2026): Mesa Identidade Visual e Naming (/mesa-identidade).
-- Pedido do dono: "Mesa criação de identidade visual, com ferramentas, técnicas e arquivos para exportar
-- completo o modelo do brandbook padrão"; "estúdio sequencial desde o início"; "área de naming e criador de
-- nomes (entra também em campanhas e identidade), rebranding ou marca do zero, com motores, baixar e enviar
-- para aprovação no painel e no grupo do WhatsApp".
--
-- Só amplia e é idempotente. Nada de mexer em RLS existente nem em can_access_client.
-- RLS nas tabelas novas: a equipe lê (is_staff + can_access_client); só a service_role escreve (tudo passa pela
-- função mesa-identidade, que confere o acesso ao cliente). Apagar = arquivar (estado 'arquivado').
-- A página pública do brandbook lê só o retrato publicado, por token, pela RPC idv_brandbook_publico.
--
-- 1. Seletor de clientes: a Mesa Identidade ganha o seu valor ('identidade') no CHECK (padrão de acrescentar).
-- 2. idv_projetos: um projeto de identidade por marca (do zero ou rebranding), com as etapas e os dados.
-- 3. idv_naming_rodadas: cada rodada do criador de nomes (marca, campanha ou produto), com candidatos,
--    filtros, ranking do Jev, finalistas, PDF, aprovação e o registro do envio no grupo.
-- 4. idv_brandbooks: o brandbook como JSON versionado (uma linha por versão), o PDF e a página pública.
-- 5. idv_eventos: o gancho do documento de entrega (frente DOC): cada entrega grande com o resumo e as provas.
-- 6. RPC idv_brandbook_publico(token): a página pública (sem login) lê só o que foi publicado.

-- ─── 1) Seletor de clientes ───────────────────────────────────────────────────
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.mesa_cliente_escolhas') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def
  FROM pg_constraint
  WHERE conrelid = 'public.mesa_cliente_escolhas'::regclass AND conname = 'mesa_cliente_escolhas_mesa_check';
  -- O banco guarda a lista como literal de array ('{roteiros,foto,...}'::text[]), não como itens entre
  -- aspas: lê os dois formatos. Visto em 30/09 (SELECT): CHECK ((mesa = ANY ('{roteiros,foto,edicao,videos,
  -- ads,publicidade,organica}'::text[]))). A lista conhecida entra sempre junto: só amplia, nunca encolhe.
  _valores := ARRAY['organica', 'ads', 'foto', 'videos', 'publicidade', 'roteiros', 'edicao'];
  IF _def IS NOT NULL THEN
    IF _def ~ '\{[a-z_,]*\}' THEN
      _valores := _valores || string_to_array(substring(_def from '\{([a-z_,]*)\}'), ',');
    ELSE
      _valores := _valores || ARRAY(SELECT m[1] FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m);
    END IF;
  END IF;
  _valores := ARRAY(SELECT DISTINCT v FROM unnest(_valores || ARRAY['identidade']) AS v WHERE v <> '' ORDER BY v);
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format(
    'ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))',
    _valores
  );
END $$;

-- ─── 2) idv_projetos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Marca do cliente (cliente_marcas). Nulo = a marca principal (o kit do cliente).
  marca_id uuid,
  modo text NOT NULL CHECK (modo IN ('zero', 'rebranding')),
  -- Rebranding com troca de nome: a etapa Naming entra (na marca do zero, sempre entra).
  com_naming boolean NOT NULL DEFAULT false,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  etapa text NOT NULL DEFAULT 'briefing' CHECK (etapa IN ('inicio', 'briefing', 'pesquisa', 'naming', 'conceito', 'sistema', 'mockups', 'guideline', 'entrega')),
  concluidas text[] NOT NULL DEFAULT ARRAY['inicio']::text[],
  -- briefing, pesquisa, naming, conceito (caminhos e escolhido), sistema (logos, cores, tipografia, grafismos, regras), guideline, entrega.
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Controle de edição: salvar parcial manda a versão que leu; outra pessoa salvou antes = 409.
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  estado text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'entregue', 'arquivado')),
  arquivado_em timestamptz,
  arquivado_por uuid,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idv_projetos_id_cliente_unico UNIQUE (id, client_id)
);

DO $migration$
BEGIN
  IF to_regclass('public.cliente_marcas') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_projetos_marca_fk') THEN
    ALTER TABLE public.idv_projetos
      ADD CONSTRAINT idv_projetos_marca_fk FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id) ON DELETE SET NULL (marca_id);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idv_projetos_cliente_idx ON public.idv_projetos (client_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idv_projetos_marca_idx ON public.idv_projetos (marca_id) WHERE marca_id IS NOT NULL;

COMMENT ON TABLE public.idv_projetos IS
  'Mesa Identidade (frente IDV): projeto de identidade visual por marca (do zero ou rebranding), etapas em sequência e os dados de cada etapa. Escrita só pela função mesa-identidade.';

-- ─── 3) idv_naming_rodadas ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_naming_rodadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  projeto_id uuid,
  -- Campanha da Mesa (mesa_campanhas), só por id (a campanha pode ser arquivada).
  campanha_id uuid,
  alvo text NOT NULL DEFAULT 'marca' CHECK (alvo IN ('marca', 'campanha', 'produto')),
  pedido text CHECK (pedido IS NULL OR char_length(pedido) <= 2000),
  criterios jsonb NOT NULL DEFAULT '[]'::jsonb,
  tecnicas text[] NOT NULL DEFAULT '{}'::text[],
  -- [{ id, nome, tecnica, justificativa, pronuncia, slug, filtros, nota_jev, nota, finalista }]
  candidatos jsonb NOT NULL DEFAULT '[]'::jsonb,
  escolhido text CHECK (escolhido IS NULL OR char_length(escolhido) <= 60),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_aprovacao', 'aprovado', 'arquivado')),
  arquivo_pdf_id uuid,
  mensagem_grupo text CHECK (mensagem_grupo IS NULL OR char_length(mensagem_grupo) <= 4000),
  enviado_grupo_em timestamptz,
  enviado_grupo_por uuid,
  aviso_jev text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF to_regclass('public.cliente_marcas') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_naming_rodadas_marca_fk') THEN
    ALTER TABLE public.idv_naming_rodadas
      ADD CONSTRAINT idv_naming_rodadas_marca_fk FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id) ON DELETE SET NULL (marca_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_naming_rodadas_projeto_fk') THEN
    ALTER TABLE public.idv_naming_rodadas
      ADD CONSTRAINT idv_naming_rodadas_projeto_fk FOREIGN KEY (projeto_id, client_id)
      REFERENCES public.idv_projetos (id, client_id) ON DELETE SET NULL (projeto_id);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idv_naming_rodadas_cliente_idx ON public.idv_naming_rodadas (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idv_naming_rodadas_projeto_idx ON public.idv_naming_rodadas (projeto_id) WHERE projeto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idv_naming_rodadas_campanha_idx ON public.idv_naming_rodadas (campanha_id) WHERE campanha_id IS NOT NULL;

COMMENT ON TABLE public.idv_naming_rodadas IS
  'Criador de nomes (frente IDV): candidatos por técnica, domínio pelo RDAP público, @ e INPI a conferir, ranking do Jev, finalistas, PDF, aprovação e o envio registrado no grupo (o Hermes envia).';

-- ─── 4) idv_brandbooks ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_brandbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  projeto_id uuid NOT NULL,
  modelo text NOT NULL CHECK (modelo IN ('prancha', 'paginado')),
  versao integer NOT NULL CHECK (versao >= 1),
  -- O brandbook como dado (supabase/functions/_shared/brandbook.ts). RGB e CMYK não são guardados: saem do HEX.
  dados jsonb NOT NULL,
  nota text CHECK (nota IS NULL OR char_length(nota) <= 400),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_aprovacao', 'aprovado', 'arquivado')),
  arquivo_pdf_id uuid,
  -- Página pública por link: token aleatório de 32 caracteres; o retrato publicado não leva caminho nem cliente.
  token_publico text UNIQUE CHECK (token_publico IS NULL OR token_publico ~ '^[A-Za-z0-9_-]{32}$'),
  publicado jsonb,
  publicado_em timestamptz,
  publicado_por uuid,
  revogado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idv_brandbooks_versao_unica UNIQUE (projeto_id, versao)
);

DO $migration$
BEGIN
  IF to_regclass('public.cliente_marcas') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_brandbooks_marca_fk') THEN
    ALTER TABLE public.idv_brandbooks
      ADD CONSTRAINT idv_brandbooks_marca_fk FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id) ON DELETE SET NULL (marca_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_brandbooks_projeto_fk') THEN
    ALTER TABLE public.idv_brandbooks
      ADD CONSTRAINT idv_brandbooks_projeto_fk FOREIGN KEY (projeto_id, client_id)
      REFERENCES public.idv_projetos (id, client_id) ON DELETE CASCADE;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idv_brandbooks_cliente_idx ON public.idv_brandbooks (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idv_brandbooks_projeto_idx ON public.idv_brandbooks (projeto_id, versao DESC);

COMMENT ON TABLE public.idv_brandbooks IS
  'Brandbook versionado (frente IDV): uma linha por versão, modelo prancha ou paginado (24 páginas), PDF em Arquivos e a página pública por token (revogável).';

-- ─── 5) idv_eventos (gancho do documento de entrega) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.idv_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  projeto_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('naming_enviado', 'naming_grupo', 'naming_escolhido', 'brandbook_enviado', 'brandbook_publicado', 'brandbook_revogado', 'kit_aplicado', 'projeto_entregue')),
  resumo text NOT NULL CHECK (char_length(resumo) BETWEEN 1 AND 1000),
  -- Provas: ids de arquivo, versão, links, quem fez.
  provas jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idv_eventos_cliente_idx ON public.idv_eventos (client_id, criado_em DESC);

COMMENT ON TABLE public.idv_eventos IS
  'Gancho do documento de entrega (frente DOC): cada entrega grande da Mesa Identidade com o resumo e as provas.';

-- ─── RLS: equipe lê; só service_role escreve ─────────────────────────────────
ALTER TABLE public.idv_projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_naming_rodadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_brandbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idv_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idv_projetos_staff_read ON public.idv_projetos;
CREATE POLICY idv_projetos_staff_read ON public.idv_projetos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS idv_naming_rodadas_staff_read ON public.idv_naming_rodadas;
CREATE POLICY idv_naming_rodadas_staff_read ON public.idv_naming_rodadas
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS idv_brandbooks_staff_read ON public.idv_brandbooks;
CREATE POLICY idv_brandbooks_staff_read ON public.idv_brandbooks
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS idv_eventos_staff_read ON public.idv_eventos;
CREATE POLICY idv_eventos_staff_read ON public.idv_eventos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.idv_projetos, public.idv_naming_rodadas, public.idv_brandbooks, public.idv_eventos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.idv_projetos, public.idv_naming_rodadas, public.idv_brandbooks, public.idv_eventos FROM authenticated;
GRANT SELECT ON public.idv_projetos, public.idv_naming_rodadas, public.idv_brandbooks, public.idv_eventos TO authenticated;
GRANT ALL ON public.idv_projetos, public.idv_naming_rodadas, public.idv_brandbooks, public.idv_eventos TO service_role;

-- ─── 6) Página pública do brandbook ──────────────────────────────────────────
-- Só o retrato publicado (sem caminho de arquivo, sem cliente), por token, e só enquanto não foi revogado.
CREATE OR REPLACE FUNCTION public.idv_brandbook_publico(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _saida jsonb;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object('brandbook', b.publicado, 'versao', b.versao, 'modelo', b.modelo, 'publicado_em', b.publicado_em)
    INTO _saida
  FROM public.idv_brandbooks b
  WHERE b.token_publico = _token
    AND b.publicado IS NOT NULL
    AND b.revogado_em IS NULL
    AND b.status <> 'arquivado'
  LIMIT 1;
  RETURN _saida;
END;
$$;

REVOKE ALL ON FUNCTION public.idv_brandbook_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.idv_brandbook_publico(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'mesa_cliente_escolhas_mesa_check';
-- select table_name from information_schema.tables where table_name like 'idv_%';
-- select policyname, cmd from pg_policies where tablename like 'idv_%';
-- Teste da RLS sem gravar: begin; set local role authenticated; insert into public.idv_eventos (client_id, tipo, resumo) values (gen_random_uuid(), 'kit_aplicado', 'x'); rollback;
