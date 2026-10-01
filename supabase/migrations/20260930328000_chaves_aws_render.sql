-- Chaves do render na nuvem (Remotion Lambda, 01/10/2026).
--
-- O dono criou a conta da AWS para renderizar os vídeos fora do PC. As duas
-- chaves do usuário remotion-user entram pelo admin (Configurações › Chaves)
-- como as outras: valor só no Vault, aqui o ponteiro. Só amplia a lista de
-- nomes aceitos. Idempotente.

ALTER TABLE public.chaves_cofre DROP CONSTRAINT IF EXISTS chaves_cofre_nome_check;
ALTER TABLE public.chaves_cofre ADD CONSTRAINT chaves_cofre_nome_check CHECK (nome IN (
    'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY', 'FAL_KEY', 'TYPESAFE_API_KEY', 'RESEND_API_KEY',
    'VERCEL_TOKEN', 'RUNWAYML_API_SECRET', 'HEYGEN_API_KEY', 'HIGGSFIELD_API_KEY',
    'HIGGSFIELD_API_SECRET', 'SECOND_BRAIN_GITHUB_TOKEN', 'OPENART_API_KEY',
    'REMOTION_AWS_ACCESS_KEY_ID', 'REMOTION_AWS_SECRET_ACCESS_KEY'
  ));
