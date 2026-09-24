-- ═══════════════════════════════════════════════════════════════════════
-- MESA FOTO: estúdio fotográfico da Mesa (docs/mesa-foto/CONTRATO.md).
--
-- Acervo único: cliente_imagens serve às três mesas (Mesa, Mesa Ads e Mesa
-- Foto) e ganha linhagem (derivada_de), marca de imagem gerada, modo,
-- vínculo com o kit, sha256, dimensões e aprovação. Novas tabelas: kits de
-- referência (foto_kits e foto_kit_refs), ensaios com tomadas e versões
-- (foto_ensaios) e a biblioteca de prompts e referências (foto_biblioteca).
--
-- Escrita pela função mesa-foto (chave de serviço); a equipe com acesso ao
-- cliente lê. Idempotente: pode rodar mais de uma vez. NÃO aplicar sem o
-- dono: validar com begin/rollback e aplicar pelo SQL Editor.
--
-- ia_usos e agente_conversas não mudam: a função usa tarefas e agentes já
-- aceitos (estudio, leitura_referencia, verificacao; diretor_arte, leitor,
-- gerador_imagem, jev) e referencia_tipo livre ('foto_ensaio',
-- 'cliente_imagem', 'foto_kit', 'mesa_foto').
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Acervo: cliente_imagens ganha linhagem e metadados da Mesa Foto ──

ALTER TABLE public.cliente_imagens
  ADD COLUMN IF NOT EXISTS derivada_de uuid,
  ADD COLUMN IF NOT EXISTS gerada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS modo text,
  ADD COLUMN IF NOT EXISTS kit_id uuid,
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS largura integer,
  ADD COLUMN IF NOT EXISTS altura integer,
  ADD COLUMN IF NOT EXISTS aprovada boolean NOT NULL DEFAULT false;

-- origem aceita também 'mesa_foto' (o check original não tinha nome próprio).
ALTER TABLE public.cliente_imagens DROP CONSTRAINT IF EXISTS cliente_imagens_origem_check;
ALTER TABLE public.cliente_imagens
  ADD CONSTRAINT cliente_imagens_origem_check CHECK (origem IN ('workspace', 'arquivo', 'upload', 'mesa_foto'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_modo_check') THEN
    ALTER TABLE public.cliente_imagens
      ADD CONSTRAINT cliente_imagens_modo_check CHECK (modo IS NULL OR modo IN ('preservar', 'luz_cor', 'cenario', 'angulo', 'ensaio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_dimensoes_check') THEN
    ALTER TABLE public.cliente_imagens
      ADD CONSTRAINT cliente_imagens_dimensoes_check CHECK ((largura IS NULL OR largura > 0) AND (altura IS NULL OR altura > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_sha256_check') THEN
    ALTER TABLE public.cliente_imagens
      ADD CONSTRAINT cliente_imagens_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  -- Alvo dos vínculos compostos (referência e derivada nunca trocam de cliente).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_id_cliente_unico') THEN
    ALTER TABLE public.cliente_imagens ADD CONSTRAINT cliente_imagens_id_cliente_unico UNIQUE (id, client_id);
  END IF;
  -- Linhagem: a derivada aponta para a imagem de origem do MESMO cliente.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_derivada_de_fk') THEN
    ALTER TABLE public.cliente_imagens
      ADD CONSTRAINT cliente_imagens_derivada_de_fk FOREIGN KEY (derivada_de, client_id)
      REFERENCES public.cliente_imagens (id, client_id) ON DELETE NO ACTION;
  END IF;
END $$;

-- Duplicata exata não duplica: um sha256 por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS cliente_imagens_sha256_unico ON public.cliente_imagens (client_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS cliente_imagens_derivada_idx ON public.cliente_imagens (derivada_de) WHERE derivada_de IS NOT NULL;
CREATE INDEX IF NOT EXISTS cliente_imagens_kit_idx ON public.cliente_imagens (kit_id) WHERE kit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cliente_imagens_mesa_foto_idx ON public.cliente_imagens (client_id, criado_em DESC) WHERE origem = 'mesa_foto';

-- A equipe continua editando nome, pasta, categoria, tags, descrição e ativa
-- na tela da Mesa; linhagem, gerada, modo, sha256 e aprovada só pela função.
REVOKE UPDATE ON public.cliente_imagens FROM authenticated;
GRANT UPDATE (nome, pasta, categoria, tags, descricao, ativa) ON public.cliente_imagens TO authenticated;

-- ─── 2) Kits de referência ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.foto_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('produto', 'pessoa', 'alimento', 'bebida', 'cosmetico', 'moda', 'tecnologia', 'outro')),
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  variante text,
  atributos jsonb NOT NULL DEFAULT '{"observado": [], "informado": [], "inferido": []}'::jsonb CHECK (jsonb_typeof(atributos) = 'object'),
  invariantes text[] NOT NULL DEFAULT '{}',
  lacunas text[] NOT NULL DEFAULT '{}',
  -- Pessoas: { confirmada, finalidade, escopo, validade, observacao, registrada_por, registrada_em }.
  autorizacao jsonb CHECK (autorizacao IS NULL OR jsonb_typeof(autorizacao) = 'object'),
  frente_imagem_id uuid,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'confirmado', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foto_kits_id_cliente_unico UNIQUE (id, client_id),
  CONSTRAINT foto_kits_frente_fk FOREIGN KEY (frente_imagem_id, client_id)
    REFERENCES public.cliente_imagens (id, client_id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS foto_kits_cliente_idx ON public.foto_kits (client_id, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS public.foto_kit_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL,
  client_id uuid NOT NULL,
  imagem_id uuid NOT NULL,
  papel text NOT NULL CHECK (papel IN ('identidade', 'detalhe', 'embalagem', 'verso', 'rotulo', 'rosto', 'corpo', 'pose', 'estilo', 'cenario')),
  vista text CHECK (vista IS NULL OR vista IN (
    'frente', 'tres_quartos_direito', 'lateral_direita', 'posterior_direito', 'verso', 'posterior_esquerdo',
    'lateral_esquerda', 'tres_quartos_esquerdo', 'topo', 'base', 'detalhe', 'livre'
  )),
  prioridade integer NOT NULL DEFAULT 100 CHECK (prioridade BETWEEN 0 AND 1000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foto_kit_refs_unico UNIQUE (kit_id, imagem_id, papel),
  -- Kit e imagem do MESMO cliente: produto de outro cliente nunca vira referência.
  CONSTRAINT foto_kit_refs_kit_fk FOREIGN KEY (kit_id, client_id) REFERENCES public.foto_kits (id, client_id) ON DELETE CASCADE,
  CONSTRAINT foto_kit_refs_imagem_fk FOREIGN KEY (imagem_id, client_id) REFERENCES public.cliente_imagens (id, client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS foto_kit_refs_imagem_idx ON public.foto_kit_refs (imagem_id);

-- Derivada aponta para o kit que a produziu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_imagens_kit_fk') THEN
    ALTER TABLE public.cliente_imagens
      ADD CONSTRAINT cliente_imagens_kit_fk FOREIGN KEY (kit_id) REFERENCES public.foto_kits (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 3) Ensaios (tomadas e versões em jsonb) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.foto_ensaios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kit_id uuid NOT NULL,
  receita_id text NOT NULL,
  receita_versao text NOT NULL,
  finalidade text,
  formatos text[] NOT NULL DEFAULT '{4:5}' CHECK (formatos <@ ARRAY['1:1', '4:5', '9:16', '16:9', '3:2', '2:3']::text[] AND cardinality(formatos) > 0),
  -- [{ id, nome, camera { azimute, elevacao, enquadramento, preset_id }, cenario, luz, lente, modo, gerado,
  --    angulo_novo, invariantes, proibicoes, pode_mudar, formato, status, motivo_bloqueio,
  --    versoes [{ versao, imagem_id, storage_path, custo_usd, conferencia, aprovada, motivo_rejeicao, criado_em, ... }] }]
  tomadas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tomadas) = 'array'),
  -- Conceito do diretor, lacunas que limitam, perguntas, modelo usado e estimativa.
  direcao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(direcao) = 'object'),
  pedido text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  status text NOT NULL DEFAULT 'planejado' CHECK (status IN ('planejado', 'em_producao', 'concluido', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- Kit arquivado, não apagado: o histórico do ensaio fica.
  CONSTRAINT foto_ensaios_kit_fk FOREIGN KEY (kit_id, client_id) REFERENCES public.foto_kits (id, client_id) ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS foto_ensaios_cliente_idx ON public.foto_ensaios (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS foto_ensaios_kit_idx ON public.foto_ensaios (kit_id);

-- ─── 4) Biblioteca de prompts e referências de imagem ──────────────────
-- client_id nulo = biblioteca da agência (semente em docs/mesa-foto/biblioteca/seed.sql);
-- uuid = item do cliente (próprio ou cópia de um da agência).

CREATE TABLE IF NOT EXISTS public.foto_biblioteca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('prompt', 'referencia')),
  categoria text NOT NULL CHECK (categoria IN (
    'produto', 'alimento', 'bebida', 'cosmetico', 'moda', 'tecnologia', 'pessoa', 'ambiente', 'estilo', 'composicao', 'luz', 'cenario'
  )),
  titulo text NOT NULL CHECK (length(btrim(titulo)) > 0),
  prompt_pt text,
  prompt_en text,
  negativo text,
  imagem_url text,
  storage_path text,
  fonte_nome text,
  fonte_url text,
  licenca text,
  autor text,
  -- Página do autor (atribuição de licenças CC BY).
  autor_url text,
  tags text[] NOT NULL DEFAULT '{}',
  destaque boolean NOT NULL DEFAULT false,
  -- Quando usar o item (texto da curadoria).
  uso text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT foto_biblioteca_conteudo_check CHECK (
    (tipo = 'prompt' AND (prompt_pt IS NOT NULL OR prompt_en IS NOT NULL))
    OR (tipo = 'referencia' AND (imagem_url IS NOT NULL OR storage_path IS NOT NULL))
  )
);
-- Quem criou a tabela antes desta versão ganha as colunas novas.
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS uso text;
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS autor_url text;
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS foto_biblioteca_cliente_idx ON public.foto_biblioteca (client_id, tipo, categoria);
CREATE INDEX IF NOT EXISTS foto_biblioteca_agencia_idx ON public.foto_biblioteca (tipo, categoria, destaque) WHERE client_id IS NULL;

-- ─── 5) atualizado_em automático (trava otimista da função) ────────────

DROP TRIGGER IF EXISTS foto_kits_tocar ON public.foto_kits;
CREATE TRIGGER foto_kits_tocar BEFORE UPDATE ON public.foto_kits FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS foto_ensaios_tocar ON public.foto_ensaios;
CREATE TRIGGER foto_ensaios_tocar BEFORE UPDATE ON public.foto_ensaios FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();
DROP TRIGGER IF EXISTS foto_biblioteca_tocar ON public.foto_biblioteca;
CREATE TRIGGER foto_biblioteca_tocar BEFORE UPDATE ON public.foto_biblioteca FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ─── 6) RLS: equipe com acesso ao cliente lê; escrita só pela função ────

ALTER TABLE public.foto_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_kit_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_ensaios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foto_biblioteca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.foto_kits, public.foto_kit_refs, public.foto_ensaios, public.foto_biblioteca FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS foto_kits_equipe_le ON public.foto_kits;
CREATE POLICY foto_kits_equipe_le ON public.foto_kits FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS foto_kit_refs_equipe_le ON public.foto_kit_refs;
CREATE POLICY foto_kit_refs_equipe_le ON public.foto_kit_refs FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS foto_ensaios_equipe_le ON public.foto_ensaios;
CREATE POLICY foto_ensaios_equipe_le ON public.foto_ensaios FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS foto_biblioteca_equipe_le ON public.foto_biblioteca;
CREATE POLICY foto_biblioteca_equipe_le ON public.foto_biblioteca FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

GRANT SELECT ON public.foto_kits, public.foto_kit_refs, public.foto_ensaios, public.foto_biblioteca TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foto_kits, public.foto_kit_refs, public.foto_ensaios, public.foto_biblioteca TO service_role;

-- ─── 7) Original imutável no Storage ────────────────────────────────────
-- Os originais da Mesa Foto ficam em mesa/<cliente>/foto/originais/. A equipe
-- envia (INSERT continua liberado pela regra "mesa: equipe envia"), mas não
-- sobrescreve nem apaga: regras restritivas somam às permissivas da Mesa. A
-- função (chave de serviço) só apaga a cópia recém enviada de uma duplicata
-- exata, que nunca virou original. COALESCE: caminho curto (sem subpasta)
-- dá NULL na comparação e não pode travar os arquivos de sempre da Mesa.

DROP POLICY IF EXISTS "mesa foto: original nao muda" ON storage.objects;
CREATE POLICY "mesa foto: original nao muda" ON storage.objects
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (NOT COALESCE(storage.objects.bucket_id = 'mesa' AND (storage.foldername(storage.objects.name))[2] = 'foto' AND (storage.foldername(storage.objects.name))[3] = 'originais', false));

DROP POLICY IF EXISTS "mesa foto: original nao sai" ON storage.objects;
CREATE POLICY "mesa foto: original nao sai" ON storage.objects
AS RESTRICTIVE FOR DELETE TO authenticated
USING (NOT COALESCE(storage.objects.bucket_id = 'mesa' AND (storage.foldername(storage.objects.name))[2] = 'foto' AND (storage.foldername(storage.objects.name))[3] = 'originais', false));

-- Conferência (rodar depois de aplicar):
-- select conname from pg_constraint where conrelid = 'public.cliente_imagens'::regclass order by 1;
-- select tablename, policyname, permissive, cmd from pg_policies where tablename like 'foto_%' or policyname like 'mesa foto:%';
