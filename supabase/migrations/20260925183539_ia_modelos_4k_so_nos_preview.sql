-- 4K pelo OpenRouter (26/09): a chamada real respondeu 400 "image_size '4K' is not supported by
-- google/gemini-3-pro-image; only google/gemini-3-pro-image-preview and google/gemini-3.1-flash-image-preview".
-- As versões normais ficam até 2K; as duas preview entram ativas para o "Detalhar em 4K".
UPDATE public.ia_modelos
   SET capacidades = jsonb_set(capacidades, '{resolucoes}', '["1K", "2K"]'::jsonb),
       preco_imagem = preco_imagem - 'res_4K'
 WHERE id = 'openrouter:google/gemini-3-pro-image' AND capacidades IS NOT NULL;

UPDATE public.ia_modelos
   SET capacidades = jsonb_set(capacidades, '{resolucoes}', '["512", "1K", "2K"]'::jsonb),
       preco_imagem = preco_imagem - 'res_4K'
 WHERE id = 'openrouter:google/gemini-3.1-flash-image' AND capacidades IS NOT NULL;

UPDATE public.ia_modelos
   SET ativo = true,
       disponivel = true,
       capacidades = coalesce(capacidades, '{}'::jsonb)
         || '{"api": "chat", "refs_max": 14, "resolucoes": ["1K", "2K", "4K"], "fundo_transparente": false, "seed": false}'::jsonb
 WHERE id IN ('openrouter:google/gemini-3-pro-image-preview', 'openrouter:google/gemini-3.1-flash-image-preview');