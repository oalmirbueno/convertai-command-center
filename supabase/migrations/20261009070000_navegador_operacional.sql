-- Navegador remoto operacional (09/10/2026, lote C): Hermes e Gestor usam o navegador do cliente.
--
-- Só amplia e é idempotente.
-- - navegador_sessoes ganha a trava de comando (um agente por vez: comandada_por + trava_ate)
--   e a última atividade (o zelador encerra a sessão parada).
-- - navegador_acoes: cada ação de agente ou da equipe no navegador, com o resultado e a
--   evidência (URL, título, trecho lido e a captura de tela no Storage). É o registro que
--   a Central mostra e que prova o que foi feito.
-- - Rotina navegador-zelar (a cada 10 min): encerra sessões paradas, para não gastar horas.
-- Leitura: equipe. Escrita: só a função navegador-remoto e o MCP (chave de serviço).

ALTER TABLE public.navegador_sessoes
  ADD COLUMN IF NOT EXISTS comandada_por text,
  ADD COLUMN IF NOT EXISTS trava_ate timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_atividade timestamptz DEFAULT now();

CREATE TABLE IF NOT EXISTS public.navegador_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id uuid REFERENCES public.navegador_sessoes(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agente text NOT NULL CHECK (agente IN ('hermes', 'gestor', 'equipe')),
  acao text NOT NULL,
  alvo text,
  pedido text,
  ok boolean NOT NULL,
  resultado text,
  url text,
  titulo text,
  evidencia_caminho text,
  erro text,
  aprovacao_id uuid,
  duracao_ms integer,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS navegador_acoes_cliente_idx ON public.navegador_acoes (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS navegador_acoes_sessao_idx ON public.navegador_acoes (sessao_id, criado_em DESC);

ALTER TABLE public.navegador_acoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS navegador_acoes_staff_le ON public.navegador_acoes;
CREATE POLICY navegador_acoes_staff_le ON public.navegador_acoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS navegador_acoes_servico ON public.navegador_acoes;
CREATE POLICY navegador_acoes_servico ON public.navegador_acoes FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON public.navegador_acoes FROM authenticated, anon;

-- Zelador: a cada 10 min a função encerra as sessões paradas (mesmo padrão das outras rotinas).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'navegador-zelar') THEN
    PERFORM cron.unschedule('navegador-zelar');
  END IF;
  PERFORM cron.schedule('navegador-zelar', '*/10 * * * *', $cron$
    select net.http_post(
      url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/navegador-remoto',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('acao', 'zelar')
    );
  $cron$);
END $$;
