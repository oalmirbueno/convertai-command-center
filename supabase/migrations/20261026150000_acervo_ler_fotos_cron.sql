-- 26/10/2026: as fotos do acervo sem descrição passam a ser lidas sozinhas (dono: "o Estúdio tem que ler as
-- fotos e achar interessante colocar de forma inteligente imagens reais quando tem").
--
-- A cada 30 minutos a função acervo-ler-fotos (só com o x-cron-secret e a chave de serviço) lê por visão até 16
-- fotos ativas de cliente_imagens sem descrição (nunca logo, gerada por IA nem referência da internet), na
-- carteira de cada cliente (pula quem tem menos de US$ 0,30), e grava descrição, etiquetas (assunto, ambiente,
-- objetos, com ou sem pessoa, antes e depois, foto_real ou arte_ou_print) e a categoria quando estava vazia.
-- Nunca apaga nada; a foto que não abre sai da fila depois de 3 tentativas (etiqueta leitura_falhou:N).
-- Só agenda; é idempotente (pode rodar de novo).
-- Para desligar: select cron.unschedule(jobid) from cron.job where jobname = 'acervo-ler-fotos-30min';
--
-- Não aplicar direto: o dono aplica na integração (SQL Editor) e registra no manifesto.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'acervo-ler-fotos-30min';
    PERFORM cron.schedule('acervo-ler-fotos-30min', '23,53 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/acervo-ler-fotos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('limit', 16),
        timeout_milliseconds := 150000
      );
    $cron$);
  END IF;
END $$;
