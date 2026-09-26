-- Frente E2 (26/09): Mesa Vídeos (geração) separada da Mesa Edição (/mesa-edicao).
-- Só amplia, idempotente. Nada de tabela nova: as duas mesas usam as tabelas da
-- Mesa Vídeos (V2-01) e a função mesa-videos. RLS continua a mesma (equipe lê via
-- is_staff + can_access_client; só a service_role escreve).
--
-- Sem este SQL:
--   * a Mesa Edição abre e funciona (subir, organizar, pacote, versões);
--   * o seletor de clientes da Mesa Edição mostra o padrão, mas incluir/retirar
--     cliente dá "Mesa desconhecida";
--   * "Mandar para a Edição" (vídeo gerado aprovado), o pedido de cena de roteiro
--     sem foto (gerar_cena) e "Salvar versão" com o projeto de edição avisam que
--     falta o SQL E2-01.

-- ─── 1) Seletor de clientes: a Mesa Edição ganha o seu valor ('edicao') ────────────
-- Mesmo jeito da V2-01 e da R2: ACRESCENTA à lista que já está no banco (não apaga
-- nenhuma mesa de outra frente). A RPC mesa_escolher_cliente só confere o formato.
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
    _valores := ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  -- Garante a lista atual inteira mais 'edicao'.
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['organica', 'ads', 'foto', 'publicidade', 'videos', 'roteiros', 'edicao']));
  EXECUTE 'ALTER TABLE public.mesa_cliente_escolhas DROP CONSTRAINT IF EXISTS mesa_cliente_escolhas_mesa_check';
  EXECUTE format(
    'ALTER TABLE public.mesa_cliente_escolhas ADD CONSTRAINT mesa_cliente_escolhas_mesa_check CHECK (mesa = ANY (%L::text[]))',
    _valores
  );
END $$;

-- ─── 2) Pedido de cena de roteiro sem foto (texto para vídeo): tipo 'gerar_cena' ───
DO $$
DECLARE
  _def text;
  _valores text[];
BEGIN
  IF to_regclass('public.video_pedidos') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO _def
  FROM pg_constraint
  WHERE conrelid = 'public.video_pedidos'::regclass AND conname = 'video_pedidos_tipo_check';
  IF _def IS NULL THEN
    _valores := ARRAY['animar_cena', 'transcrever', 'legendar'];
  ELSE
    SELECT array_agg(DISTINCT m[1]) INTO _valores FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m;
  END IF;
  _valores := ARRAY(SELECT DISTINCT unnest(_valores || ARRAY['animar_cena', 'transcrever', 'legendar', 'gerar_cena']));
  EXECUTE 'ALTER TABLE public.video_pedidos DROP CONSTRAINT IF EXISTS video_pedidos_tipo_check';
  EXECUTE format(
    'ALTER TABLE public.video_pedidos ADD CONSTRAINT video_pedidos_tipo_check CHECK (tipo = ANY (%L::text[]))',
    _valores
  );
END $$;

-- ─── 3) Vídeo gerado aprovado entra na Entrada da Edição ─────────────────────────────
-- edicao_desde preenchido = o vídeo gerado foi aprovado na Mesa Vídeos e está na
-- Mesa Edição. Nulo = fica só nos Resultados da Mesa Vídeos. Gravações de fora
-- (bruto, take, áudio) aparecem na Edição sempre, sem depender desta coluna.
DO $$
BEGIN
  IF to_regclass('public.video_arquivos') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.video_arquivos ADD COLUMN IF NOT EXISTS edicao_desde timestamptz;
  CREATE INDEX IF NOT EXISTS video_arquivos_edicao_idx ON public.video_arquivos (client_id, edicao_desde) WHERE edicao_desde IS NOT NULL;
  COMMENT ON COLUMN public.video_arquivos.edicao_desde IS
    'Frente E2: quando o vídeo gerado foi aprovado na Mesa Vídeos e mandado para a Mesa Edição. Nulo: só nos Resultados.';
END $$;

-- ─── 4) Projeto de edição versionado (base do editor completo) ──────────────────────
-- Um JSON por versão (supabase/functions/_shared/projeto-de-edicao.ts): formato, fps,
-- fontes, trilhas (vídeo, texto, legenda, áudio, sobreposição) e clipes com entrada e
-- saída. Versão aprovada continua imutável (gatilho video_versoes_aprovada_imutavel):
-- mudar o projeto aprovado é registrar a próxima versão. O pacote e o edl.json saem dele.
DO $$
BEGIN
  IF to_regclass('public.video_versoes') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.video_versoes ADD COLUMN IF NOT EXISTS projeto jsonb;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_versoes_projeto_objeto') THEN
    ALTER TABLE public.video_versoes
      ADD CONSTRAINT video_versoes_projeto_objeto CHECK (projeto IS NULL OR (jsonb_typeof(projeto) = 'object' AND pg_column_size(projeto) <= 1500000));
  END IF;
  COMMENT ON COLUMN public.video_versoes.projeto IS
    'Frente E2: projeto de edição desta versão (trilhas, clipes, textos, transições; _shared/projeto-de-edicao.ts). revisao sobe a cada gravação.';
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname in ('mesa_cliente_escolhas_mesa_check', 'video_pedidos_tipo_check');
-- select table_name, column_name from information_schema.columns where (table_name, column_name) in (('video_arquivos', 'edicao_desde'), ('video_versoes', 'projeto'));
