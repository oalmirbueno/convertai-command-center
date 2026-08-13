-- ============================================================================
-- Aceleriq OS - ligar a publicação automática e tornar a falha visível
-- ============================================================================
--
-- Diagnóstico: o motor de publicação automática nunca publicou nada desde que
-- foi criado, por dois motivos independentes que se somavam.
--
--   1. O interruptor geral nasceu desligado e nenhuma migração o ligava.
--   2. O motor só olha para publicações marcadas como "automatic", mas o painel
--      nunca dizia isso ao agendar. Toda publicação nascia "manual", então a
--      fila do motor era sempre vazia, por construção.
--
-- O ponto 2 foi corrigido no painel (o agendamento passa a declarar entrega
-- automática quando cabe no limite da Meta). Esta migração cuida do resto.
--
-- SEGURANÇA DA VIRADA: de propósito NÃO existe nenhum backfill aqui. Tudo o que
-- já estava agendado continua manual e não vai disparar sozinho de uma vez.
-- Só o que for agendado a partir de agora entra no modo automático, então dá
-- para testar com um post, conferir, e só então confiar no fluxo inteiro.
-- ============================================================================

-- ─────────────────────────── 1. Ligar o motor ───────────────────────────────
UPDATE social_private.autopublish_settings
SET
  enabled = true,
  -- O contador de tentativas é do job inteiro, não de cada passo. Um carrossel
  -- consome uma tentativa por cartão, então com o limite antigo (3) qualquer
  -- instabilidade matava o carrossel no meio, sem nova tentativa de verdade.
  max_attempts = 12,
  updated_at = now()
WHERE id;

-- ────────────── 2. A falha deixa de ser invisível para a equipe ──────────────
--
-- Hoje o erro da publicação automática fica gravado num schema privado, sem
-- nenhuma leitura possível pelo painel. Na prática: a publicação falhava e
-- continuava com o selo de "Programado" para sempre, sem ninguém saber.
--
-- Esta view expõe SOMENTE o estado da entrega, sem token e sem segredo, e só
-- para a equipe que atende aquele cliente.
CREATE OR REPLACE VIEW public.autopublish_status_secure AS
SELECT
  job.publication_id,
  job.client_id,
  job.stage,
  job.attempts,
  job.last_error,
  job.permalink,
  job.created_at,
  job.updated_at
FROM social_private.autopublish_jobs AS job
WHERE public.is_staff(auth.uid())
  AND public.can_access_client(job.client_id);

COMMENT ON VIEW public.autopublish_status_secure IS
  'Estado da publicacao automatica para a equipe. Sem token e sem segredo. '
  'Filtra por is_staff e can_access_client na propria view.';

REVOKE ALL ON public.autopublish_status_secure FROM PUBLIC, anon;
GRANT SELECT ON public.autopublish_status_secure TO authenticated;

-- ─────────── 3. Conferência do agendador (somente leitura, sem efeito) ───────
DO $$
DECLARE
  _job_active boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT active INTO _job_active
    FROM cron.job
    WHERE jobname = 'editorial-autopublish';

    IF _job_active IS NULL THEN
      RAISE WARNING 'Agendador editorial-autopublish nao encontrado: a publicacao automatica nao vai rodar.';
    ELSIF NOT _job_active THEN
      RAISE WARNING 'Agendador editorial-autopublish existe mas esta desativado.';
    ELSE
      RAISE NOTICE 'Agendador editorial-autopublish ativo, rodando a cada minuto.';
    END IF;
  ELSE
    RAISE WARNING 'pg_cron ausente: a publicacao automatica nao tem quem a dispare.';
  END IF;
END;
$$;
