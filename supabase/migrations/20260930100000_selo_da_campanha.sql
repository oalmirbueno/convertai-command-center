-- ═══════════════════════════════════════════════════════════════════════
-- SELO DA CAMPANHA: VERSÕES, ORIGEM E REFERÊNCIAS (frente SEL, 30/09).
--
-- Pedido do dono (29/09): "na parte de Campanhas ele gera o selo, mas eu
-- quero poder escolher um selo pronto também, pedir para ele melhorar,
-- enviar uma referência, tudo. Ele está gerando muitos selos genéricos. E
-- também posso escolher o selo de fora, por exemplo uma logo."
--
-- Antes: mesa_campanhas.selo_path era sobrescrito a cada "Desenhar de novo"
-- (o anterior ficava perdido no bucket, sem voltar) e só existia um caminho
-- (gerar). Agora cada selo é uma versão guardada, com a origem:
--   gerado     -> opção desenhada pelo gerador (várias por vez, lote_id);
--   melhorado  -> edição de uma versão (anterior_id), pedido em texto e referências;
--   acervo     -> imagem pronta do acervo do cliente (cliente_imagens);
--   arquivo    -> selo antigo de outra campanha do mesmo cliente;
--   enviado    -> PNG, SVG, JPG ou WebP enviado de fora;
--   logo       -> a logo da marca da campanha (regra de herança da marca).
-- mesa_campanhas.selo_id aponta a versão escolhida e selo_path continua sendo
-- o caminho que o Estúdio lê (nada muda para quem só lê o caminho).
--
-- Escrita só pela função agente-calendario (chave de serviço), que confere
-- o acesso ao cliente em toda ação. A equipe lê pela RLS (is_staff e
-- can_access_client). Apagar é arquivar (arquivado_em). Idempotente e só
-- amplia: nenhuma coluna existente muda.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mesa_campanha_selos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES public.mesa_campanhas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Caminho no bucket mesa (PNG com fundo transparente, lado até 512 px).
  caminho text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('gerado', 'melhorado', 'acervo', 'arquivo', 'enviado', 'logo')),
  -- Estilo nomeado do gerador (carimbo, badge_circular, fita...), quando houver.
  estilo text,
  -- O texto que o selo deveria trazer e a conferência da leitura ({ ok, lido, faltando, sobrando, aviso }).
  texto text,
  conferencia jsonb,
  -- Pedido do "Melhorar este selo" e a versão de partida.
  pedido text,
  anterior_id uuid REFERENCES public.mesa_campanha_selos(id) ON DELETE SET NULL,
  -- Opções geradas juntas (a tela mostra lado a lado para escolher).
  lote_id uuid,
  -- De onde veio o arquivo pronto ({ tipo: 'cliente_imagens'|'marca'|'selo'|'envio', id?, nome?, marca_id? }).
  fonte jsonb,
  modelo_id text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  -- Última vez em que esta versão virou o selo da campanha (o histórico ordena por aqui).
  escolhido_em timestamptz,
  arquivado_em timestamptz,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mesa_campanha_selos IS
  'Versões do selo de cada campanha (gerado, melhorado, acervo, arquivo, enviado, logo). mesa_campanhas.selo_id aponta a escolhida. Escrita só pela função agente-calendario. Frente SEL, 30/09.';

CREATE INDEX IF NOT EXISTS mesa_campanha_selos_campanha_idx ON public.mesa_campanha_selos (campanha_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS mesa_campanha_selos_cliente_idx ON public.mesa_campanha_selos (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS mesa_campanha_selos_lote_idx ON public.mesa_campanha_selos (lote_id) WHERE lote_id IS NOT NULL;

ALTER TABLE public.mesa_campanha_selos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mesa_campanha_selos FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS mesa_campanha_selos_equipe_le ON public.mesa_campanha_selos;
CREATE POLICY mesa_campanha_selos_equipe_le ON public.mesa_campanha_selos
FOR SELECT TO authenticated
USING (public.is_staff((SELECT auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.mesa_campanha_selos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mesa_campanha_selos TO service_role;

-- ─── A campanha aponta a versão escolhida e guarda as referências do selo ───

ALTER TABLE public.mesa_campanhas
  ADD COLUMN IF NOT EXISTS selo_id uuid REFERENCES public.mesa_campanha_selos(id) ON DELETE SET NULL;
-- [{ caminho, papel: 'estilo'|'forma'|'cor'|'inspiracao', confianca, nota, descricao }] (papel pelo Jev).
ALTER TABLE public.mesa_campanhas
  ADD COLUMN IF NOT EXISTS selo_referencias jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_selo_referencias_lista') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_selo_referencias_lista CHECK (jsonb_typeof(selo_referencias) = 'array');
  END IF;
END $$;

-- Só a função grava as colunas novas: a equipe continua podendo mudar só nome,
-- status e referencias_ids (GRANT UPDATE por coluna de 23/09, que não muda).

-- ─── O selo de hoje vira a primeira versão (sem perder nada) ───────────────

INSERT INTO public.mesa_campanha_selos (campanha_id, client_id, caminho, origem, texto, escolhido_em, criado_em, fonte)
SELECT c.id, c.client_id, c.selo_path, 'gerado', NULLIF(c.identidade #>> '{selo,texto}', ''), c.atualizado_em, c.atualizado_em,
       jsonb_build_object('tipo', 'antes_das_versoes')
  FROM public.mesa_campanhas c
 WHERE c.selo_path IS NOT NULL
   AND c.selo_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.mesa_campanha_selos s WHERE s.campanha_id = c.id AND s.caminho = c.selo_path);

UPDATE public.mesa_campanhas c
   SET selo_id = s.id
  FROM public.mesa_campanha_selos s
 WHERE c.selo_id IS NULL
   AND c.selo_path IS NOT NULL
   AND s.campanha_id = c.id
   AND s.caminho = c.selo_path;
