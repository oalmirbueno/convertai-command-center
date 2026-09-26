-- Frente V-A (26/09): gerador de vídeo da Mesa Vídeos (motores, ângulo, continuar,
-- transição, antes e depois de uma foto, agente diretor, bíblia, roteiro e templates).
-- NÃO APLICADO. Só amplia, idempotente. RLS: equipe lê (is_staff + can_access_client),
-- só a service_role escreve (a função mesa-videos grava tudo).
--
-- Ordem dos SQL de vídeo (todos no scratchpad desta sessão):
--   1. V-01-cenas-historia-personagem.sql  (Canvas/História; JÁ no banco: foto_cenas_da_historia existe)
--   2. V2-01-mesa-videos.sql               (tabelas video_*; JÁ no banco: video_arquivos existe)
--   3. R2-mesa-roteiros.sql e V2-02-roteiros-para-video.sql (JÁ no banco: a view existe)
--   4. E2-01-mesa-edicao.sql               (PENDENTE: gerar_cena, edicao_desde, projeto, 'edicao')
--   5. V-01-motores-de-video.sql           (este; PENDENTE)
-- Não rodar de novo P-01 nem Z9 depois da E2-01: eles gravam a lista de mesas fixa sem 'edicao'
-- (o bloco 7 abaixo recoloca, se acontecer).
-- Sem este SQL:
--   * a tela abre, os kits, a bíblia e o roteiro funcionam no navegador (guardados por
--     cliente) e o custo aparece;
--   * gerar, ângulo, continuar, transição e antes e depois recusam com
--     "banco_sem_gerador" (o pedido não tem onde morar);
--   * o diretor conversa e devolve a bíblia e o roteiro, mas não grava no banco.

-- ─── 1) Pedidos: tipos e estados novos da geração ────────────────────────────────────
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.video_pedidos') IS NULL THEN
    RETURN;
  END IF;
  -- tipo
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.video_pedidos'::regclass AND conname = 'video_pedidos_tipo_check';
  IF _def IS NULL THEN
    _valores := ARRAY['animar_cena', 'transcrever', 'legendar', 'gerar_cena'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY[
    'animar_cena', 'transcrever', 'legendar', 'gerar_cena',
    'gerar_livre', 'gerar_plano', 'angulo', 'continuar_video', 'transicao', 'antes_depois_imagem'
  ]));
  EXECUTE 'ALTER TABLE public.video_pedidos DROP CONSTRAINT IF EXISTS video_pedidos_tipo_check';
  EXECUTE format('ALTER TABLE public.video_pedidos ADD CONSTRAINT video_pedidos_tipo_check CHECK (tipo = ANY (%L::text[]))', _valores);

  -- estado
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.video_pedidos'::regclass AND conname = 'video_pedidos_estado_check';
  IF _def IS NULL THEN
    _valores := ARRAY['em_breve', 'aguardando_confirmacao', 'cancelado'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY[
    'em_breve', 'aguardando_confirmacao', 'cancelado',
    'enviado', 'gerando', 'baixando', 'pronto', 'parcial', 'erro'
  ]));
  EXECUTE 'ALTER TABLE public.video_pedidos DROP CONSTRAINT IF EXISTS video_pedidos_estado_check';
  EXECUTE format('ALTER TABLE public.video_pedidos ADD CONSTRAINT video_pedidos_estado_check CHECK (estado = ANY (%L::text[]))', _valores);

  -- Quando consultar (sem laço: só a tela ou o próximo passo pedem; o prazo encerra).
  ALTER TABLE public.video_pedidos ADD COLUMN IF NOT EXISTS projeto_id uuid;
  ALTER TABLE public.video_pedidos ADD COLUMN IF NOT EXISTS prazo_em timestamptz;
  ALTER TABLE public.video_pedidos ADD COLUMN IF NOT EXISTS consultado_em timestamptz;
  CREATE INDEX IF NOT EXISTS video_pedidos_pendentes_idx ON public.video_pedidos (client_id, estado)
    WHERE estado IN ('enviado', 'gerando', 'baixando');
  CREATE INDEX IF NOT EXISTS video_pedidos_projeto_idx ON public.video_pedidos (projeto_id) WHERE projeto_id IS NOT NULL;
END $$;

-- ─── 2) Arquivos: ângulo e quadro (imagens que servem ao vídeo) ──────────────────────
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.video_arquivos') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.video_arquivos'::regclass AND conname = 'video_arquivos_tipo_check';
  IF _def IS NULL THEN
    _valores := ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['bruto', 'take', 'gerado', 'audio', 'entrega', 'angulo', 'quadro']));
  EXECUTE 'ALTER TABLE public.video_arquivos DROP CONSTRAINT IF EXISTS video_arquivos_tipo_check';
  EXECUTE format('ALTER TABLE public.video_arquivos ADD CONSTRAINT video_arquivos_tipo_check CHECK (tipo = ANY (%L::text[]))', _valores);

  ALTER TABLE public.video_arquivos ADD COLUMN IF NOT EXISTS pedido_id uuid;
  ALTER TABLE public.video_arquivos ADD COLUMN IF NOT EXISTS origem jsonb;
  CREATE INDEX IF NOT EXISTS video_arquivos_pedido_idx ON public.video_arquivos (pedido_id) WHERE pedido_id IS NOT NULL;
  COMMENT ON COLUMN public.video_arquivos.origem IS
    'Frente V-A: de onde veio o gerado (motor, endpoint, pedido, plano, variação, custo). Nunca leva chave.';
END $$;

-- ─── 3) Projetos do diretor (bíblia e roteiro) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_diretor_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 120),
  kit_id text,
  template_id uuid,
  fase text NOT NULL DEFAULT 'briefing' CHECK (fase IN ('briefing', 'pesquisa', 'biblia', 'roteiro', 'livre')),
  briefing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(briefing) = 'object'),
  biblia jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(biblia) = 'object'),
  roteiro jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(roteiro) = 'object'),
  -- Últimas mensagens da conversa com o diretor (texto e avisos; sem chave, sem URL assinada).
  conversa jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conversa) = 'array'),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  estado text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (pg_column_size(biblia) + pg_column_size(roteiro) + pg_column_size(conversa) <= 1500000)
);
CREATE INDEX IF NOT EXISTS video_diretor_projetos_cliente_idx ON public.video_diretor_projetos (client_id, atualizado_em DESC);
ALTER TABLE public.video_diretor_projetos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_diretor_projetos_equipe_le ON public.video_diretor_projetos;
CREATE POLICY video_diretor_projetos_equipe_le ON public.video_diretor_projetos
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
REVOKE INSERT, UPDATE, DELETE ON public.video_diretor_projetos FROM anon, authenticated;
GRANT SELECT ON public.video_diretor_projetos TO authenticated;
GRANT ALL ON public.video_diretor_projetos TO service_role;

-- ─── 4) Templates de vídeo (por cliente e da agência) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nulo: template da agência (sem arquivos de cliente dentro).
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  kit_id text,
  estrutura jsonb NOT NULL CHECK (jsonb_typeof(estrutura) = 'object' AND pg_column_size(estrutura) <= 800000),
  estado text NOT NULL DEFAULT 'ativo' CHECK (estado IN ('ativo', 'arquivado')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_templates_cliente_idx ON public.video_templates (client_id, atualizado_em DESC);
ALTER TABLE public.video_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_templates_equipe_le ON public.video_templates;
CREATE POLICY video_templates_equipe_le ON public.video_templates
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND (client_id IS NULL OR public.can_access_client(client_id)));
REVOKE INSERT, UPDATE, DELETE ON public.video_templates FROM anon, authenticated;
GRANT SELECT ON public.video_templates TO authenticated;
GRANT ALL ON public.video_templates TO service_role;

-- ─── 5) Catálogo de motores de vídeo sincronizado (video_motores) ───────────────────
-- Como os motores de vídeo entram no catálogo (decisão desta frente):
--   * a lista conferida (preço, fonte, data, capacidades) mora em código:
--     supabase/functions/_shared/modelos-de-video.ts (MOTORES_DE_VIDEO);
--   * esta tabela guarda o que MUDA sem publicar código, no mesmo jeito do ia_modelos
--     sincronizado do OpenRouter (novo, disponivel, sincronizado_em, fonte_preco):
--       - linha com o id de um motor do código: ativo = false DESLIGA o motor;
--         disponivel = false (a lista do provedor tirou) também tira da geração;
--       - linha nova (versão nova de uma linha conhecida, achada pela sincronização
--         semanal na lista pública do fal, GET https://api.fal.ai/v1/models) entra
--         com novo = true e SEM preço: aparece na tela como "novo" e não gera;
--       - quando o dono grava o preço conferido (preco, fonte_preco, conferido_em),
--         a versão mais nova da linha vira o Top sozinha (regra no código:
--         Top = mais nova ativa da linha com preço; Normal = mais barata que atende;
--         Rápido = rascunho). Nada vira padrão sem preço conferido.
--   * Por que não no ia_modelos: o check de tipo (texto, imagem) e de provedor
--     (openai, anthropic, openrouter) e as telas e o ia-motor.ts que leem o catálogo
--     só conhecem texto e imagem; misturar vídeo ali mexe em telas de outras frentes.
--     O uso do vídeo é registrado no ia_usos (modelo_id "video:<motor>", provedor "fal",
--     tarefa "estudio", agente "gerador_imagem", valores que o banco já aceita).
CREATE TABLE IF NOT EXISTS public.video_motores (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 2 AND 80),
  linha text NOT NULL,
  versao text NOT NULL,
  rotulo text NOT NULL,
  endpoints jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(endpoints) = 'object'),
  -- {"por_segundo": {"720p": 0.1}, "por_segundo_audio": {...}, "por_video": n, "por_imagem": n, "fonte": url, "conferido_em": data}
  preco jsonb CHECK (preco IS NULL OR jsonb_typeof(preco) = 'object'),
  fonte_preco text,
  conferido_em timestamptz,
  novo boolean NOT NULL DEFAULT true,
  disponivel boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  sincronizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.video_motores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS video_motores_equipe_le ON public.video_motores;
CREATE POLICY video_motores_equipe_le ON public.video_motores
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.video_motores FROM anon, authenticated;
GRANT SELECT ON public.video_motores TO authenticated;
GRANT ALL ON public.video_motores TO service_role;

-- ─── 6) Sincronização semanal (DESLIGADA) ────────────────────────────────────────────
-- Segunda 06:23 de Brasília (09:23 GMT). Criada e logo desligada: o dono liga quando
-- quiser com  select cron.alter_job(jobid, active := true) from cron.job where jobname = 'video-motores-sincronizar-semanal';
-- A função só aceita do cron a ação motores_sincronizar (x-cron-secret).
DO $$
DECLARE
  _id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'video-motores-sincronizar-semanal';
    SELECT cron.schedule('video-motores-sincronizar-semanal', '23 9 * * 1', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-videos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'motores_sincronizar'),
        timeout_milliseconds := 60000
      );
    $cron$) INTO _id;
    PERFORM cron.alter_job(_id, active := false);
  END IF;
END $$;

-- ─── 7) Seletor de clientes: garante a lista inteira das mesas (só amplia) ──────────
-- P-01 e Z9 gravaram a lista fixa sem 'edicao'; a E2-01 acrescenta 'edicao'. Este bloco
-- repete a ampliação (lê o que está no banco e soma), para que rodar a V-01 por último
-- nunca apague mesa nenhuma. Resultado esperado:
-- 'organica','ads','foto','publicidade','videos','roteiros','edicao'.
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.mesa_cliente_escolhas') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
  WHERE conrelid = 'public.mesa_cliente_escolhas'::regclass AND conname = 'mesa_cliente_escolhas_mesa_check';
  SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(coalesce(_def, ''), '''([a-z_]+)''', 'g') AS m;
  _valores := ARRAY(SELECT DISTINCT unnest(coalesce(_valores, '{}'::text[]) || ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros', 'edicao']));
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format('ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))', _valores);
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname in ('video_pedidos_tipo_check','video_pedidos_estado_check','video_arquivos_tipo_check','mesa_cliente_escolhas_mesa_check');
-- select count(*) from public.video_diretor_projetos; select count(*) from public.video_templates; select count(*) from public.video_motores;
-- select jobname, active from cron.job where jobname = 'video-motores-sincronizar-semanal';
