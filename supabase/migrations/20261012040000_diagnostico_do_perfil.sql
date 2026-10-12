-- 12/10/2026 (ig-profile-optimizer): diagnóstico do perfil em 9 partes, guardado junto da análise da bio
-- no plano da conta (reabrir sem gastar de novo). Escreve só a função mesa-instagram (service_role);
-- a leitura segue a política que já existe na tabela.
ALTER TABLE public.cliente_instagram_planos
  ADD COLUMN IF NOT EXISTS diagnostico jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_instagram_planos_diagnostico_objeto') THEN
    ALTER TABLE public.cliente_instagram_planos
      ADD CONSTRAINT cliente_instagram_planos_diagnostico_objeto CHECK (diagnostico IS NULL OR jsonb_typeof(diagnostico) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.cliente_instagram_planos.diagnostico IS
  'Diagnóstico do perfil em 9 partes (foto, nome, @, bio, link, categoria, destaques, fixados, grade): {versao, linhas[{parte, estado, detalhe, como_corrigir, fonte}], resumo, para_fixar, gerado_em}.';
