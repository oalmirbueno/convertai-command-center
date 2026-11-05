-- GPT Image 2.6 pelo OpenRouter, como padrão de imagem (05/11/2026).
--
-- Dono: "vamos deixar disponível o novo modelo de imagem pelo OpenRouter da OpenAI no painel e deixar como padrão".
-- Lançado em 05/11/2026 (GET https://openrouter.ai/api/v1/images/models). Mesmo preço por token e mesmos parâmetros do
-- 2.5 (proporções, qualidade, fundo, até 16 referências), então copia preço e capacidades da linha do 2.5.
-- Sunburst (detalhe e texto) vira o padrão; Flare (cerca de 50% mais rápido) fica para escolher. O 2.5 continua ativo.
-- Trabalhos em andamento não mudam: cada um segue com o modelo que já escolheu.
-- Reverter: devolver 'imagem' em padrao_para à linha openai:gpt-image-2.5-sunburst.

INSERT INTO public.ia_modelos (
  id, provedor, modelo_api, tipo, rotulo,
  preco_entrada_1m, preco_saida_1m, preco_cache_1m, preco_imagem, capacidades,
  raciocinio, padrao_para, ativo, novo, disponivel, fonte_preco, conferido_em, sincronizado_em
)
SELECT v.id, 'openrouter', v.modelo_api, 'imagem', v.rotulo,
  base.preco_entrada_1m, base.preco_saida_1m, base.preco_cache_1m, base.preco_imagem,
  jsonb_set(base.capacidades, '{fonte}', to_jsonb('https://openrouter.ai/api/v1/images/models/' || v.modelo_api || '/endpoints'))
    || '{"formatos_saida":["png","jpeg","webp","gif"]}'::jsonb,
  '{}'::text[], '{}'::text[], true, true, true,
  'https://openrouter.ai/' || v.modelo_api || ' (conferido em 05/11/2026: mesmo preço do GPT Image 2.5; o custo real vem em usage.cost)',
  now(), now()
FROM (VALUES
  ('openrouter:openai/gpt-image-2.6-sunburst', 'openai/gpt-image-2.6-sunburst', 'OpenAI: GPT Image 2.6 Sunburst (OpenRouter)'),
  ('openrouter:openai/gpt-image-2.6-flare', 'openai/gpt-image-2.6-flare', 'OpenAI: GPT Image 2.6 Flare (OpenRouter)')
) AS v(id, modelo_api, rotulo)
JOIN public.ia_modelos base ON base.id = 'openrouter:openai/gpt-image-2.5-sunburst'
ON CONFLICT (id) DO UPDATE SET ativo = true, disponivel = true, novo = true, preco_imagem = EXCLUDED.preco_imagem, capacidades = EXCLUDED.capacidades, rotulo = EXCLUDED.rotulo;

UPDATE public.ia_modelos SET padrao_para = array_remove(padrao_para, 'imagem')
WHERE 'imagem' = ANY(padrao_para) AND id <> 'openrouter:openai/gpt-image-2.6-sunburst';
UPDATE public.ia_modelos SET padrao_para = array_append(array_remove(padrao_para, 'imagem'), 'imagem')
WHERE id = 'openrouter:openai/gpt-image-2.6-sunburst';
