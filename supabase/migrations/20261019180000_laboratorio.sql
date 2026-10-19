-- Laboratório da Aceleriq (19/10/2026, pedido do dono).
--
-- Área livre para trabalhos avulsos (com ou sem cliente): projetos em canvas de nós, execuções por nó e
-- templates de fluxo. Contrato: Aceleriq-Laboratorio/ESPEC-LABORATORIO.md (seção "Banco").
-- Função de borda: supabase/functions/laboratorio (só admin, manager e design).
--
-- Regras:
-- * A equipe (is_staff) lê; ninguém escreve direto pelo navegador: toda escrita passa pela função
--   (chave de serviço). Projeto com cliente só aparece para quem acessa o cliente.
-- * Projeto sem cliente = "Livre" (paga a carteira do cliente interno da Aceleriq).
-- * estudio_trabalhos.origem separa o Estúdio livre do Laboratório da Mesa do cliente (a Mesa só lista 'mesa').
-- * ia_usos.tarefa aceita 'laboratorio' (mesmo jeito da seção 4 de 20260930320200_navegador_do_agente.sql).
-- * Semente: os 6 templates oficiais (supabase/functions/laboratorio/modulos/templates.ts).
--
-- Idempotente e só amplia. Nada é apagado.

-- ─── 1) Projetos do Laboratório ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_projetos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 200),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  contexto text,
  -- { nos: [{ id, tipo, x, y, dados }], ligacoes: [{ id, de, para }], viewport: { x, y, zoom } }
  canvas jsonb NOT NULL DEFAULT '{"nos": [], "ligacoes": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}'::jsonb,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado')),
  template_de uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_projetos_canvas_check CHECK (
    jsonb_typeof(canvas) = 'object'
    AND jsonb_typeof(COALESCE(canvas -> 'nos', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(COALESCE(canvas -> 'ligacoes', '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(canvas -> 'nos', '[]'::jsonb)) <= 80
    AND jsonb_array_length(COALESCE(canvas -> 'ligacoes', '[]'::jsonb)) <= 160
  )
);

CREATE INDEX IF NOT EXISTS lab_projetos_lista_idx ON public.lab_projetos (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS lab_projetos_cliente_idx ON public.lab_projetos (client_id, updated_at DESC) WHERE client_id IS NOT NULL;

-- ─── 2) Execuções por nó ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES public.lab_projetos(id) ON DELETE CASCADE,
  no_id text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('contexto', 'midia', 'config', 'gravity', 'agente', 'copy', 'imagem', 'carrossel', 'logo', 'landing', 'anuncio', 'agente_externo')),
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'rodando', 'pronto', 'erro', 'aguardando')),
  entrada jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { texto, imagens: [{ path, url }], html_path, json, tarefa_id, escolha, avisos, usos }
  saida jsonb,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  uso_id uuid,
  erro text,
  operador_slug text,
  rodada_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS lab_execucoes_projeto_idx ON public.lab_execucoes (projeto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_execucoes_no_idx ON public.lab_execucoes (projeto_id, no_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_execucoes_rodada_idx ON public.lab_execucoes (rodada_id) WHERE rodada_id IS NOT NULL;

-- ─── 3) Templates de fluxo ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 200),
  descricao text,
  icone text,
  canvas jsonb NOT NULL CHECK (jsonb_typeof(canvas) = 'object'),
  oficial boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 4) RLS: a equipe lê; escrita só pela função (chave de serviço) ─────────
ALTER TABLE public.lab_projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.lab_projetos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lab_execucoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lab_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lab_projetos TO authenticated;
GRANT SELECT ON public.lab_execucoes TO authenticated;
GRANT SELECT ON public.lab_templates TO authenticated;
GRANT ALL ON public.lab_projetos TO service_role;
GRANT ALL ON public.lab_execucoes TO service_role;
GRANT ALL ON public.lab_templates TO service_role;

DROP POLICY IF EXISTS lab_projetos_equipe_le ON public.lab_projetos;
CREATE POLICY lab_projetos_equipe_le ON public.lab_projetos
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.is_staff((select auth.uid())), false)
    AND (client_id IS NULL OR COALESCE(public.can_access_client(client_id), false))
  );

DROP POLICY IF EXISTS lab_execucoes_equipe_le ON public.lab_execucoes;
CREATE POLICY lab_execucoes_equipe_le ON public.lab_execucoes
  FOR SELECT TO authenticated
  USING (
    COALESCE(public.is_staff((select auth.uid())), false)
    AND EXISTS (
      SELECT 1 FROM public.lab_projetos p
      WHERE p.id = lab_execucoes.projeto_id
        AND (p.client_id IS NULL OR COALESCE(public.can_access_client(p.client_id), false))
    )
  );

DROP POLICY IF EXISTS lab_templates_equipe_le ON public.lab_templates;
CREATE POLICY lab_templates_equipe_le ON public.lab_templates
  FOR SELECT TO authenticated
  USING (COALESCE(public.is_staff((select auth.uid())), false));

-- ─── 5) Estúdio: origem do trabalho (a Mesa do cliente só lista 'mesa') ─────
DO $origem$
BEGIN
  IF to_regclass('public.estudio_trabalhos') IS NOT NULL THEN
    ALTER TABLE public.estudio_trabalhos ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'mesa';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estudio_trabalhos_origem_check') THEN
      ALTER TABLE public.estudio_trabalhos
        ADD CONSTRAINT estudio_trabalhos_origem_check CHECK (origem IN ('mesa', 'laboratorio'));
    END IF;
    CREATE INDEX IF NOT EXISTS estudio_trabalhos_origem_idx ON public.estudio_trabalhos (origem, criado_em DESC) WHERE origem <> 'mesa';
  END IF;
END
$origem$;

-- ─── 6) ia_usos aceita 'laboratorio' (custo do Laboratório na carteira) ────
DO $$
DECLARE
  _alvo record;
  _def text;
  _valores text[];
BEGIN
  FOR _alvo IN
    SELECT *
    FROM (VALUES
      ('ia_usos', 'tarefa', 'ia_usos_tarefa_check')
    ) AS t(tabela, coluna, restricao)
  LOOP
    IF to_regclass('public.' || _alvo.tabela) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT pg_get_constraintdef(oid) INTO _def FROM pg_constraint
     WHERE conrelid = ('public.' || _alvo.tabela)::regclass AND conname = _alvo.restricao;
    -- Já aceita (nas duas formas que o Postgres mostra: ARRAY['a'::text] e '{a,b}'::text[]): não mexe.
    IF _def IS NULL OR _def ~ '(''|\{|,)laboratorio(''|\}|,)' THEN
      CONTINUE;
    END IF;
    -- Lê as duas formas; sem isso, rodar de novo depois de um ADD CONSTRAINT %L::text[] estreitaria a lista.
    SELECT array_agg(DISTINCT v) INTO _valores FROM (
      SELECT m[1] AS v FROM regexp_matches(_def, '''([a-z_]+)''', 'g') AS m
      UNION
      SELECT btrim(x, ' "') FROM unnest(string_to_array(substring(_def FROM '\{([^}]*)\}'), ',')) AS x
    ) s WHERE v ~ '^[a-z_]+$';
    IF COALESCE(cardinality(_valores), 0) = 0 THEN
      CONTINUE;
    END IF;
    _valores := ARRAY(SELECT DISTINCT unnest(COALESCE(_valores, '{}'::text[]) || ARRAY['laboratorio']));
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', _alvo.tabela, _alvo.restricao);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I = ANY (%L::text[]))', _alvo.tabela, _alvo.restricao, _alvo.coluna, _valores);
  END LOOP;
END $$;

-- ─── 7) Semente: os 6 templates oficiais ────────────────────────────────────
INSERT INTO public.lab_templates (id, nome, descricao, icone, canvas, oficial)
VALUES
  ('6c0a1b10-0000-4000-8000-000000000001'::uuid, 'Carrossel', 'Pedido e base comum entram no Construtor de carrossel: o agente planeja as lâminas e gera as artes em ordem.', 'layers', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":80,"dados":{"titulo":"Pedido","texto":"Tema do carrossel, público e o que a pessoa deve sentir ou fazer no fim."}},{"id":"gravity_1","tipo":"gravity","x":80,"y":260,"dados":{"titulo":"Base comum","prompt_base":"Mesma família visual em todas as lâminas: paleta, tipografia e luz iguais."}},{"id":"config_1","tipo":"config","x":80,"y":440,"dados":{"titulo":"Formato","proporcao":"4:5","qualidade":"media"}},{"id":"carrossel_1","tipo":"carrossel","x":400,"y":260,"dados":{"titulo":"Carrossel","laminas":5}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"carrossel_1"},{"id":"lig_2","de":"gravity_1","para":"carrossel_1"},{"id":"lig_3","de":"config_1","para":"carrossel_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000002'::uuid, 'Criativos de anúncio', 'Copy de anúncio e duas artes com a mesma base comum, fechando num pacote de anúncio que nasce pausado.', 'megaphone', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":80,"dados":{"titulo":"Oferta","texto":"Produto, oferta, público e objetivo da campanha."}},{"id":"copy_1","tipo":"copy","x":400,"y":80,"dados":{"titulo":"Copy do anúncio","formato":"anuncio"}},{"id":"gravity_1","tipo":"gravity","x":80,"y":280,"dados":{"titulo":"Base comum","prompt_base":"Criativo de anúncio limpo, produto em destaque, uma mensagem curta por arte."}},{"id":"imagem_1","tipo":"imagem","x":400,"y":280,"dados":{"titulo":"Criativo A","proporcao":"4:5","quantidade":1}},{"id":"imagem_2","tipo":"imagem","x":400,"y":460,"dados":{"titulo":"Criativo B","proporcao":"9:16","quantidade":1}},{"id":"anuncio_1","tipo":"anuncio","x":720,"y":280,"dados":{"titulo":"Pacote do anúncio"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"copy_1"},{"id":"lig_2","de":"contexto_1","para":"imagem_1"},{"id":"lig_3","de":"contexto_1","para":"imagem_2"},{"id":"lig_4","de":"gravity_1","para":"imagem_1"},{"id":"lig_5","de":"gravity_1","para":"imagem_2"},{"id":"lig_6","de":"copy_1","para":"anuncio_1"},{"id":"lig_7","de":"imagem_1","para":"anuncio_1"},{"id":"lig_8","de":"imagem_2","para":"anuncio_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000003'::uuid, 'Logo', 'Nome, conceito e paleta viram variações de logo (símbolo + logotipo, fundo liso); o Jev aponta a melhor e explica.', 'pen-tool', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":80,"dados":{"titulo":"Briefing da marca","texto":"O que a marca faz, para quem, e as palavras que ela precisa transmitir."}},{"id":"logo_1","tipo":"logo","x":400,"y":80,"dados":{"titulo":"Logo","nome":"","conceito":"","paleta":"","estilo":"minimalista","n":4}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"logo_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000004'::uuid, 'Landing page', 'Contexto e copy de landing entram no Construtor de página: sai um HTML único (Tailwind) salvo nos arquivos, com prévia.', 'layout', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":80,"dados":{"titulo":"Oferta e público","texto":"Produto, promessa, público, prova e chamada para ação."}},{"id":"copy_1","tipo":"copy","x":400,"y":80,"dados":{"titulo":"Copy da página","formato":"landing"}},{"id":"landing_1","tipo":"landing","x":720,"y":80,"dados":{"titulo":"Landing page","objetivo":"captar contato"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"copy_1"},{"id":"lig_2","de":"copy_1","para":"landing_1"},{"id":"lig_3","de":"contexto_1","para":"landing_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000005'::uuid, 'Post + legenda', 'Uma arte de feed e a legenda escrita a partir do mesmo pedido.', 'image', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":80,"dados":{"titulo":"Pedido do post","texto":"Assunto do post, tom e chamada."}},{"id":"config_1","tipo":"config","x":80,"y":260,"dados":{"titulo":"Formato","proporcao":"4:5","quantidade":1,"qualidade":"media"}},{"id":"imagem_1","tipo":"imagem","x":400,"y":80,"dados":{"titulo":"Arte do post"}},{"id":"copy_1","tipo":"copy","x":400,"y":260,"dados":{"titulo":"Legenda","formato":"legenda"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"imagem_1"},{"id":"lig_2","de":"config_1","para":"imagem_1"},{"id":"lig_3","de":"contexto_1","para":"copy_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000006'::uuid, 'Variação de criativos', 'Uma mídia de referência e uma base comum geram três variações do mesmo criativo de uma vez.', 'copy', '{"nos":[{"id":"midia_1","tipo":"midia","x":80,"y":80,"dados":{"titulo":"Criativo de referência","imagens":[]}},{"id":"gravity_1","tipo":"gravity","x":80,"y":260,"dados":{"titulo":"Base comum","prompt_base":"Manter produto, marca e mensagem; variar cena, enquadramento e cor de fundo."}},{"id":"imagem_1","tipo":"imagem","x":400,"y":80,"dados":{"titulo":"Variação 1","prompt":"Cena em ambiente claro."}},{"id":"imagem_2","tipo":"imagem","x":400,"y":260,"dados":{"titulo":"Variação 2","prompt":"Close no produto, fundo de cor sólida."}},{"id":"imagem_3","tipo":"imagem","x":400,"y":440,"dados":{"titulo":"Variação 3","prompt":"Produto em uso, luz natural."}}],"ligacoes":[{"id":"lig_1","de":"midia_1","para":"imagem_1"},{"id":"lig_2","de":"midia_1","para":"imagem_2"},{"id":"lig_3","de":"midia_1","para":"imagem_3"},{"id":"lig_4","de":"gravity_1","para":"imagem_1"},{"id":"lig_5","de":"gravity_1","para":"imagem_2"},{"id":"lig_6","de":"gravity_1","para":"imagem_3"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true)
ON CONFLICT (id) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    icone = EXCLUDED.icone,
    canvas = EXCLUDED.canvas,
    oficial = true;

-- ─── 8) Ao vivo: a tela acompanha o "Rodar tudo" pelas execuções (RLS vale) ─
DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'lab_execucoes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_execucoes;
    END IF;
  END IF;
END
$rt$;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select count(*) from public.lab_templates where oficial;  -- 6
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'ia_usos_tarefa_check';  -- tem 'laboratorio'
-- select column_default from information_schema.columns where table_name = 'estudio_trabalhos' and column_name = 'origem';  -- 'mesa'::text
