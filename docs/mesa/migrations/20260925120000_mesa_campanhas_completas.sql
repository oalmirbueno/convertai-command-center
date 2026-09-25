-- ═══════════════════════════════════════════════════════════════════════
-- MESA DO CLIENTE: CAMPANHAS COMPLETAS (IMAGENS, BRIEFING E PLANO DE IMAGENS)
--
-- Pedido do dono (25/09): "Na campanha eu vou ter que colocar as imagens que
-- eu vou querer usar nessa campanha. A campanha tem que ser mais completinha,
-- está muito genérica. Tem que ter mais contexto: analisar qual imagem vai
-- usar, usar algum tipo de produto, por quê."
--
-- mesa_campanhas ganha três colunas, todas escritas só pela função
-- agente-calendario (chave de serviço), que confere cada imagem contra o
-- acervo do cliente (cliente_imagens, inclusive as da Mesa Foto):
--
--   briefing jsonb (objeto):
--     { produtos: [{ nome, por_que }], oferta, mensagem_central, publico,
--       provas: [texto], tom, cta }
--     objetivo e período continuam nas colunas de sempre.
--
--   imagens jsonb (lista, até 12):
--     [{ imagem_id (cliente_imagens.id), papel: 'heroi' | 'apoio' | 'ambiente',
--        nota: por que usar esta imagem }]
--
--   plano_imagens jsonb (objeto ou null), feito pelo estrategista com as
--   imagens à vista e decidido pelo Jev onde há mais de uma candidata:
--     { gerado_em, assinatura, fonte: 'campanha' | 'acervo', resumo,
--       analise: [{ imagem_id, o_que_mostra, forca, serve_para }],
--       pecas: [{ tema_id, ordem, imagem_id, candidatas: [id], uso: 'fundo' |
--                 'elemento', por_que, escolha: 'estrategista' | 'jev',
--                 confianca, aviso }],
--       lacunas: [texto], jev_erro }
--     assinatura = imagens da campanha + conteúdos (tema_id:quantidade de
--     cards); a tela compara com a campanha atual para avisar que o plano
--     ficou velho.
--
-- Não muda permissão: a equipe já lê a tabela toda (GRANT SELECT) e escreve
-- estes campos pela função (ações campanha_salvar e campanha_plano_imagens).
-- Idempotente: pode rodar mais de uma vez. NÃO aplicar sem o dono mandar;
-- aplicar ANTES de publicar a função nova (a criação de campanha tem volta
-- sem as colunas, mas salvar imagens e briefing precisa delas).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.mesa_campanhas
  ADD COLUMN IF NOT EXISTS briefing jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS imagens jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS plano_imagens jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_briefing_objeto') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_briefing_objeto CHECK (jsonb_typeof(briefing) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_imagens_lista') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_imagens_lista CHECK (jsonb_typeof(imagens) = 'array' AND jsonb_array_length(imagens) <= 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_plano_objeto') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_plano_objeto CHECK (plano_imagens IS NULL OR jsonb_typeof(plano_imagens) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.mesa_campanhas.briefing IS
  'Briefing da campanha: produtos em foco com o porquê, oferta, mensagem central, público, provas, tom e CTA. Escrito pela função agente-calendario.';
COMMENT ON COLUMN public.mesa_campanhas.imagens IS
  'Imagens do acervo (cliente_imagens) escolhidas para a campanha, com papel (heroi, apoio, ambiente) e nota do porquê. Até 12.';
COMMENT ON COLUMN public.mesa_campanhas.plano_imagens IS
  'Plano de imagens: qual imagem vai em qual lâmina de qual conteúdo e por quê (estrategista com visão + Jev). O gravar leva a foto escolhida ao Estúdio.';

-- Conferência (rodar depois, só leitura):
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'mesa_campanhas'
--    AND column_name IN ('briefing', 'imagens', 'plano_imagens');
