-- Frente V2 (25/09 à noite): Mesa Vídeos (/mesa-videos), aba Edição, memória por vídeo
-- e a fila do computador do agente (desligada). Docs: docs/mesa-videos/CONTRATO.md
-- (seção "V2: o que foi construído") e docs/motores/COMPUTADOR-DO-AGENTE.md.
--
-- Só amplia, idempotente. RLS: a equipe lê (is_staff + can_access_client); só a
-- service_role escreve (tudo passa pela função mesa-videos).
--
-- Sem este SQL a mesa abre em modo degradado:
--   * fotos da Mesa Foto (cliente_imagens) e a História (foto_cenas_da_historia, SQL V-01) aparecem normais;
--   * vídeos subidos aparecem pela pasta do Storage (<cliente>/video/brutos/), sem organizador;
--   * pedidos, versões e a fila do computador avisam que falta ativar o banco.
--
-- ATENÇÃO (coordenação com R2 e P): o item 1 ACRESCENTA 'videos' ao CHECK de
-- mesa_cliente_escolhas sem apagar o que já está lá (mesmo padrão do R2). O SQL da
-- frente P (P-01) regrava o CHECK e a RPC com lista fixa ('organica','ads','foto',
-- 'publicidade'): se o P-01 for aplicado DEPOIS deste, rode de novo o item 1 deste
-- arquivo (é idempotente) ou troque a lista do P-01 pelo padrão de acrescentar.

-- ─── 1) Seletor de clientes: a Mesa Vídeos ganha o seu valor ('videos') ───────────
-- Mesmo jeito do SQL da Mesa Roteiros (R2): ACRESCENTA 'videos' à lista que já está no
-- banco (não apaga 'roteiros' nem 'publicidade'), e a RPC só confere o formato do nome;
-- quem decide quais mesas existem é o CHECK. Assim a ordem de aplicação não importa.

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
  IF _def IS NULL THEN
    _valores := ARRAY['organica', 'ads', 'foto'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  IF NOT ('videos' = ANY (_valores)) THEN
    _valores := _valores || ARRAY['videos'];
  END IF;
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format(
    'ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))',
    _valores
  );
END $$;

-- A RPC valida só o formato do nome da mesa; o CHECK acima decide quais existem
-- (mesmo corpo da versão da frente R2).
CREATE OR REPLACE FUNCTION public.mesa_escolher_cliente(_mesa text, _client_id uuid, _modo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre no painel para mudar os clientes da mesa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Só admin e gestor mudam os clientes da mesa.' USING ERRCODE = '42501';
  END IF;
  IF _mesa IS NULL OR _mesa !~ '^[a-z_]{2,30}$' THEN
    RAISE EXCEPTION 'Mesa desconhecida.' USING ERRCODE = '22023';
  END IF;
  IF _client_id IS NULL OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'Cliente fora do seu acesso.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _client_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.' USING ERRCODE = '22023';
  END IF;

  IF _modo IS NULL THEN
    DELETE FROM public.mesa_cliente_escolhas WHERE mesa = _mesa AND client_id = _client_id;
    RETURN;
  END IF;
  IF _modo NOT IN ('incluir', 'retirar') THEN
    RAISE EXCEPTION 'Modo desconhecido.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.mesa_cliente_escolhas (mesa, client_id, modo, atualizado_por, atualizado_em)
    VALUES (_mesa, _client_id, _modo, auth.uid(), now())
    ON CONFLICT (mesa, client_id)
    DO UPDATE SET modo = EXCLUDED.modo, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = EXCLUDED.atualizado_em;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'Mesa desconhecida.' USING ERRCODE = '22023';
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_escolher_cliente(text, uuid, text) TO authenticated, service_role;

-- ─── 2) video_arquivos: acervo de vídeo do cliente (gravações brutas e takes) ─────
-- O arquivo mora no bucket "mesa" em <cliente>/video/brutos/<id>.<ext> e nunca muda.
-- nome = nome de exibição (o organizador renomeia só isto); nome_original fica para sempre.

CREATE TABLE IF NOT EXISTS public.video_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  nome_original text NOT NULL CHECK (char_length(nome_original) BETWEEN 1 AND 255),
  storage_bucket text NOT NULL DEFAULT 'mesa',
  storage_path text NOT NULL,
  tipo text NOT NULL DEFAULT 'bruto' CHECK (tipo IN ('bruto', 'take', 'gerado', 'audio', 'entrega')),
  mime text,
  bytes bigint CHECK (bytes IS NULL OR bytes >= 0),
  duracao_s numeric CHECK (duracao_s IS NULL OR duracao_s >= 0),
  largura integer,
  altura integer,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  gravado_em timestamptz,
  -- Vínculo com a Mesa Roteiros (frente R2) só por id, sem chave estrangeira.
  roteiro_id uuid,
  cena_ref text CHECK (cena_ref IS NULL OR char_length(cena_ref) <= 40),
  grupo text CHECK (grupo IS NULL OR char_length(grupo) <= 80),
  melhor boolean NOT NULL DEFAULT false,
  nota text CHECK (nota IS NULL OR char_length(nota) <= 600),
  estado text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS video_arquivos_cliente_idx ON public.video_arquivos (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS video_arquivos_roteiro_idx ON public.video_arquivos (roteiro_id) WHERE roteiro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS video_arquivos_hash_idx ON public.video_arquivos (client_id, sha256) WHERE sha256 IS NOT NULL;

COMMENT ON TABLE public.video_arquivos IS
  'Acervo de vídeo da Mesa Vídeos: gravações brutas, takes, gerados, áudio e entregas. Original imutável no Storage; nome é só exibição. roteiro_id liga à Mesa Roteiros sem FK.';

-- ─── 3) video_vinculos: roteiro aprovado ↔ cena da História (Canvas) ───────────────

CREATE TABLE IF NOT EXISTS public.video_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  roteiro_id uuid NOT NULL,
  cena_ref text NOT NULL CHECK (char_length(cena_ref) BETWEEN 1 AND 40),
  canvas_id uuid NOT NULL,
  no_id text NOT NULL CHECK (char_length(no_id) BETWEEN 1 AND 80),
  estado text NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('proposto', 'confirmado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roteiro_id, cena_ref, canvas_id, no_id)
);

CREATE INDEX IF NOT EXISTS video_vinculos_cliente_idx ON public.video_vinculos (client_id, roteiro_id);

-- ─── 4) video_pedidos: pedidos preparados (animar cena, transcrever, legendar) ──────
-- Preparar não gasta: guarda parâmetros, executor e custo estimado. Sem motor: 'em_breve'.

CREATE TABLE IF NOT EXISTS public.video_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('animar_cena', 'transcrever', 'legendar')),
  alvo jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(alvo) = 'object'),
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parametros) = 'object'),
  custo_estimado jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custo_estimado) = 'object'),
  executor text NOT NULL DEFAULT 'em_breve',
  estado text NOT NULL DEFAULT 'em_breve' CHECK (estado IN ('em_breve', 'aguardando_confirmacao', 'cancelado')),
  chave text NOT NULL,
  resultado jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS video_pedidos_chave_aberta_idx ON public.video_pedidos (client_id, chave) WHERE estado <> 'cancelado';
CREATE INDEX IF NOT EXISTS video_pedidos_cliente_idx ON public.video_pedidos (client_id, criado_em DESC);

-- ─── 5) video_acoes: propostas do organizador de takes (contrato comum das ações) ──
-- Mesmo formato que acaoGuardadaNaMensagem lê (id, client_id, conversa_id, anexos).

CREATE TABLE IF NOT EXISTS public.video_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversa_id uuid,
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(anexos) = 'array'),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_acoes_cliente_idx ON public.video_acoes (client_id, criado_em DESC);

-- ─── 6) video_versoes: memória por vídeo (versão, feedback, custo, aprovação) ──────
-- Aprovada é imutável (a função recusa mudança; o gatilho abaixo também).

CREATE TABLE IF NOT EXISTS public.video_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  video_id uuid NOT NULL,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  numero integer NOT NULL CHECK (numero >= 1),
  pai_id uuid REFERENCES public.video_versoes(id) ON DELETE SET NULL,
  arquivo_id uuid REFERENCES public.video_arquivos(id) ON DELETE SET NULL,
  roteiro_id uuid,
  estado text NOT NULL DEFAULT 'em_revisao' CHECK (estado IN ('rascunho', 'em_revisao', 'aprovada', 'rejeitada')),
  custo_usd numeric CHECK (custo_usd IS NULL OR custo_usd >= 0),
  feedback jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(feedback) = 'array'),
  nota text CHECK (nota IS NULL OR char_length(nota) <= 600),
  decidido_por uuid,
  decidido_em timestamptz,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 400),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, numero)
);

CREATE INDEX IF NOT EXISTS video_versoes_cliente_idx ON public.video_versoes (client_id, criado_em DESC);

CREATE OR REPLACE FUNCTION public.video_versoes_aprovada_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.estado = 'aprovada' THEN
    RAISE EXCEPTION 'Versão aprovada é imutável: crie a próxima versão.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS video_versoes_aprovada_imutavel ON public.video_versoes;
CREATE TRIGGER video_versoes_aprovada_imutavel
  BEFORE UPDATE ON public.video_versoes
  FOR EACH ROW EXECUTE FUNCTION public.video_versoes_aprovada_imutavel();

-- ─── 7) agente_computador_tarefas: fila do computador do agente (desligada) ────────
-- Nada executa pelo painel. A função só aceita pedido com COMPUTADOR_DO_AGENTE_LIGADO=1
-- e cada tarefa nasce 'aguardando_dono'. Provas = screenshots no Storage.

CREATE TABLE IF NOT EXISTS public.agente_computador_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 140),
  app text NOT NULL DEFAULT 'outro',
  passos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(passos) = 'array'),
  irreversivel boolean NOT NULL DEFAULT false,
  estado text NOT NULL DEFAULT 'aguardando_dono' CHECK (estado IN ('aguardando_dono', 'aprovada', 'executando', 'feita', 'falhou', 'cancelada')),
  provas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(provas) = 'array'),
  motivo text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_por uuid,
  aprovado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agente_computador_tarefas_estado_idx ON public.agente_computador_tarefas (estado, criado_em DESC);

-- ─── 8) RLS: equipe lê; só service_role escreve ─────────────────────────────────────

ALTER TABLE public.video_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_acoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_computador_tarefas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_arquivos_staff_read ON public.video_arquivos;
CREATE POLICY video_arquivos_staff_read ON public.video_arquivos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS video_vinculos_staff_read ON public.video_vinculos;
CREATE POLICY video_vinculos_staff_read ON public.video_vinculos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS video_pedidos_staff_read ON public.video_pedidos;
CREATE POLICY video_pedidos_staff_read ON public.video_pedidos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS video_acoes_staff_read ON public.video_acoes;
CREATE POLICY video_acoes_staff_read ON public.video_acoes
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS video_versoes_staff_read ON public.video_versoes;
CREATE POLICY video_versoes_staff_read ON public.video_versoes
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

-- Tarefa sem cliente (organizar pasta da agência): só a equipe vê.
DROP POLICY IF EXISTS agente_computador_tarefas_staff_read ON public.agente_computador_tarefas;
CREATE POLICY agente_computador_tarefas_staff_read ON public.agente_computador_tarefas
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));

REVOKE INSERT, UPDATE, DELETE ON public.video_arquivos, public.video_vinculos, public.video_pedidos, public.video_acoes, public.video_versoes, public.agente_computador_tarefas FROM anon, authenticated;
GRANT SELECT ON public.video_arquivos, public.video_vinculos, public.video_pedidos, public.video_acoes, public.video_versoes, public.agente_computador_tarefas TO authenticated;
GRANT ALL ON public.video_arquivos, public.video_vinculos, public.video_pedidos, public.video_acoes, public.video_versoes, public.agente_computador_tarefas TO service_role;

-- ─── 9) Storage: gravação bruta não muda nem sai (como a foto original) ────────────

DROP POLICY IF EXISTS "mesa video: bruto nao muda" ON storage.objects;
CREATE POLICY "mesa video: bruto nao muda" ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (NOT COALESCE((bucket_id = 'mesa' AND (storage.foldername(name))[2] = 'video' AND (storage.foldername(name))[3] = 'brutos'), false));

DROP POLICY IF EXISTS "mesa video: bruto nao sai" ON storage.objects;
CREATE POLICY "mesa video: bruto nao sai" ON storage.objects AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (NOT COALESCE((bucket_id = 'mesa' AND (storage.foldername(name))[2] = 'video' AND (storage.foldername(name))[3] = 'brutos'), false));

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'mesa_cliente_escolhas_mesa_check';
-- select table_name from information_schema.tables where table_name in ('video_arquivos','video_vinculos','video_pedidos','video_acoes','video_versoes','agente_computador_tarefas');
-- select policyname, permissive from pg_policies where tablename in ('video_arquivos','objects') and policyname ilike '%video%';
-- Teste do gatilho sem gravar:
-- begin; update public.video_versoes set nota = 'x' where estado = 'aprovada'; rollback;
