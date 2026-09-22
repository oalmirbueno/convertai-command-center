-- Catalogo inicial curado da Mesa do cliente (SPEC.md, secoes 2 e 3).
--
-- Roda depois de 20260922123000_ia_modelos_sincronizacao (colunas novo,
-- disponivel, contexto_tokens, modalidades). A sincronizacao diaria traz o
-- resto do OpenRouter desligado; aqui ficam as escolhas do dono, ligadas.
--
-- Decisao do dono (2026-09-22): variedade escolhida e paga pelo OpenRouter.
-- Papeis padrao (padrao_para):
--   estrategista e diretor_arte: openrouter:openai/gpt-6-sol
--   leitura (texto dentro da imagem): openrouter:openai/gpt-6-luna (visao,
--     barato: US$ 0,10 entrada e 0,50 saida por 1M)
--   imagem: openai:gpt-image-2.5-sunburst (direto; a chave OpenAI existe)
-- Sem chave do OpenRouter, o motor cai para o equivalente direto da mesma
-- familia (openai:gpt-6-sol, openai:gpt-6-luna, anthropic:claude-opus-5-5),
-- por isso as linhas diretas existem aqui com preco.
--
-- Ids OpenAI conferidos na lista real da chave da agencia (ia-gateway,
-- modelos_do_provedor) em 2026-09-22. Precos em USD por 1M tokens, tabela
-- padrao; a fonte de cada linha fica em fonte_preco.
--
-- preco_imagem: custo de SAIDA por imagem 1024x1536 em cada qualidade
-- (baixa = low, media = medium, alta = high) pela calculadora oficial da
-- OpenAI; "entrada_imagem_1m" e o token de imagem de entrada. Para o
-- OpenRouter, a estimativa por imagem usa 1.290 tokens de saida (imagem 1K)
-- vezes saida_imagem_1m, e o custo real vem em usage.cost.
--
-- Idempotente: ON CONFLICT (id) DO UPDATE.

-- Cada papel fica em um so modelo: tira o papel de quem nao e escolhido aqui.
UPDATE public.ia_modelos
SET padrao_para = '{}'::text[]
WHERE cardinality(padrao_para) > 0
  AND id NOT IN ('openrouter:openai/gpt-6-sol', 'openrouter:openai/gpt-6-luna', 'openai:gpt-image-2.5-sunburst');

INSERT INTO public.ia_modelos (
  id, provedor, modelo_api, tipo, rotulo,
  preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem,
  raciocinio, padrao_para, ativo, novo, disponivel, contexto_tokens, modalidades,
  fonte_preco, conferido_em
)
VALUES
  -- OpenRouter (pago pela chave do OpenRouter) ------------------------------
  (
    'openrouter:openai/gpt-6-sol', 'openrouter', 'openai/gpt-6-sol', 'texto', 'OpenAI: GPT-6 Sol',
    2.00, 10.00, 0.20, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY['estrategista', 'diretor_arte'],
    true, false, true, 1050000,
    '{"entrada": ["file", "image", "text"], "saida": ["text"]}'::jsonb,
    'https://openrouter.ai/api/v1/models e https://openrouter.ai/openai/gpt-6-sol (conferido 2026-09-22; igual a https://developers.openai.com/api/docs/pricing)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openrouter:openai/gpt-6-luna', 'openrouter', 'openai/gpt-6-luna', 'texto', 'OpenAI: GPT-6 Luna',
    0.10, 0.50, 0.01, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY['leitura'],
    true, false, true, 1050000,
    '{"entrada": ["file", "image", "text"], "saida": ["text"]}'::jsonb,
    'https://openrouter.ai/api/v1/models e https://openrouter.ai/openai/gpt-6-luna (conferido 2026-09-22; igual a https://developers.openai.com/api/docs/pricing)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openrouter:anthropic/claude-opus-5.5', 'openrouter', 'anthropic/claude-opus-5.5', 'texto', 'Anthropic: Claude Opus 5.5',
    4.00, 20.00, 0.20, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, 1000000,
    '{"entrada": ["text", "image", "file"], "saida": ["text"]}'::jsonb,
    'https://openrouter.ai/api/v1/models e https://openrouter.ai/anthropic/claude-opus-5.5 (conferido 2026-09-22; igual a https://platform.claude.com/docs/en/about-claude/pricing)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openrouter:google/gemini-3.1-flash-image', 'openrouter', 'google/gemini-3.1-flash-image', 'imagem', 'Google: Nano Banana 2 (Gemini 3.1 Flash Image)',
    0.50, 3.00, NULL,
    '{"baixa": 0.0774, "media": 0.0774, "alta": 0.0774, "saida_imagem_1m": 60}'::jsonb,
    ARRAY['minimal', 'high'],
    ARRAY[]::text[],
    true, false, true, 131072,
    '{"entrada": ["image", "text"], "saida": ["image", "text"]}'::jsonb,
    'https://openrouter.ai/api/v1/models e https://openrouter.ai/google/gemini-3.1-flash-image (conferido 2026-09-22; oficial US$ 0,067 por imagem 1K em https://ai.google.dev/gemini-api/docs/pricing)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openrouter:google/gemini-3-pro-image', 'openrouter', 'google/gemini-3-pro-image', 'imagem', 'Google: Nano Banana Pro (Gemini 3 Pro Image)',
    2.00, 12.00, 0.20,
    '{"baixa": 0.1548, "media": 0.1548, "alta": 0.1548, "saida_imagem_1m": 120, "entrada_imagem_1m": 2}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    true, false, true, 131072,
    '{"entrada": ["image", "text"], "saida": ["image", "text"]}'::jsonb,
    'https://openrouter.ai/api/v1/models e https://openrouter.ai/google/gemini-3-pro-image (conferido 2026-09-22; oficial US$ 0,134 por imagem 1K ou 2K em https://ai.google.dev/gemini-api/docs/pricing)',
    '2026-09-22T12:00:00-03:00'
  ),

  -- OpenAI direta, texto (chave da agencia existe) ---------------------------
  (
    'openai:gpt-6-sol', 'openai', 'gpt-6-sol', 'texto', 'GPT-6 Sol (OpenAI direta)',
    2.00, 10.00, 0.20, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-6-sol (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-6-luna', 'openai', 'gpt-6-luna', 'texto', 'GPT-6 Luna (OpenAI direta)',
    0.10, 0.50, 0.01, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-6-luna (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-5.6-luna', 'openai', 'gpt-5.6-luna', 'texto', 'GPT-5.6 Luna (OpenAI direta)',
    0.20, 1.20, 0.02, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-5.6-luna (conferido 2026-09-22; preco apos o corte de 2026-07-30)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-5.6-terra', 'openai', 'gpt-5.6-terra', 'texto', 'GPT-5.6 Terra (OpenAI direta)',
    2.00, 12.00, 0.20, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-5.6-terra (conferido 2026-09-22; preco apos o corte de 2026-07-30)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-5.6-sol', 'openai', 'gpt-5.6-sol', 'texto', 'GPT-5.6 Sol (OpenAI direta)',
    4.00, 20.00, 0.40, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing (conferido 2026-09-22; promocional ate 2026-11-21, depois 5,00 e 30,00)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-5.5', 'openai', 'gpt-5.5', 'texto', 'GPT-5.5 (OpenAI direta)',
    5.00, 30.00, 0.50, NULL,
    ARRAY['none', 'low', 'medium', 'high', 'xhigh'],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-5.5 (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),

  -- OpenAI direta, imagem -----------------------------------------------------
  (
    'openai:gpt-image-2.5-sunburst', 'openai', 'gpt-image-2.5-sunburst', 'imagem', 'GPT Image 2.5 Sunburst',
    5.00, 30.00, 1.25,
    '{"baixa": 0.0047, "media": 0.0103, "alta": 0.041, "entrada_imagem_1m": 8}'::jsonb,
    ARRAY[]::text[],
    ARRAY['imagem'],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst; por imagem 1024x1536 pela calculadora oficial em https://developers.openai.com/api/docs/guides/image-generation (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-image-2.5-flare', 'openai', 'gpt-image-2.5-flare', 'imagem', 'GPT Image 2.5 Flare',
    5.00, 30.00, 1.25,
    '{"baixa": 0.0047, "media": 0.0103, "alta": 0.041, "entrada_imagem_1m": 8}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-image-2.5-flare; por imagem 1024x1536 pela calculadora oficial em https://developers.openai.com/api/docs/guides/image-generation (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'openai:gpt-image-2', 'openai', 'gpt-image-2', 'imagem', 'GPT Image 2',
    5.00, 30.00, 1.25,
    '{"baixa": 0.0047, "media": 0.041, "alta": 0.165, "entrada_imagem_1m": 8}'::jsonb,
    ARRAY[]::text[],
    ARRAY[]::text[],
    true, false, true, NULL, NULL,
    'https://developers.openai.com/api/docs/pricing e https://developers.openai.com/api/docs/models/gpt-image-2; por imagem 1024x1536 pela calculadora oficial em https://developers.openai.com/api/docs/guides/image-generation (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),

  -- Anthropic direta (desligada ate existir ANTHROPIC_API_KEY; serve de
  -- equivalente para a rota de reserva) --------------------------------------
  (
    'anthropic:claude-opus-5-5', 'anthropic', 'claude-opus-5-5', 'texto', 'Claude Opus 5.5 (Anthropic direta)',
    4.00, 20.00, 0.20, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    false, false, true, NULL, NULL,
    'https://platform.claude.com/docs/en/about-claude/pricing (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'anthropic:claude-opus-5', 'anthropic', 'claude-opus-5', 'texto', 'Claude Opus 5 (Anthropic direta)',
    5.00, 25.00, 0.50, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    false, false, true, NULL, NULL,
    'https://platform.claude.com/docs/en/about-claude/pricing (conferido 2026-09-22)',
    '2026-09-22T12:00:00-03:00'
  ),
  (
    'anthropic:claude-sonnet-5', 'anthropic', 'claude-sonnet-5', 'texto', 'Claude Sonnet 5 (Anthropic direta)',
    2.00, 10.00, 0.20, NULL,
    ARRAY['low', 'medium', 'high', 'xhigh', 'max'],
    ARRAY[]::text[],
    false, false, true, NULL, NULL,
    'https://platform.claude.com/docs/en/about-claude/pricing (conferido 2026-09-22; 2/10 passou a preco padrao)',
    '2026-09-22T12:00:00-03:00'
  )
ON CONFLICT (id) DO UPDATE SET
  provedor = EXCLUDED.provedor,
  modelo_api = EXCLUDED.modelo_api,
  tipo = EXCLUDED.tipo,
  rotulo = EXCLUDED.rotulo,
  preco_entrada_1m = EXCLUDED.preco_entrada_1m,
  preco_saida_1m = EXCLUDED.preco_saida_1m,
  preco_cache_1m = EXCLUDED.preco_cache_1m,
  preco_imagem = EXCLUDED.preco_imagem,
  raciocinio = EXCLUDED.raciocinio,
  padrao_para = EXCLUDED.padrao_para,
  ativo = EXCLUDED.ativo,
  novo = EXCLUDED.novo,
  disponivel = EXCLUDED.disponivel,
  contexto_tokens = COALESCE(EXCLUDED.contexto_tokens, public.ia_modelos.contexto_tokens),
  modalidades = COALESCE(EXCLUDED.modalidades, public.ia_modelos.modalidades),
  fonte_preco = EXCLUDED.fonte_preco,
  conferido_em = EXCLUDED.conferido_em;
