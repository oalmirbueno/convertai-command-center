-- ═══════════════════════════════════════════════════════════════════════
-- TR-01 · ROTINA DE MONITORAMENTO DO TRÁFEGO (frente TR, 27/09). NÃO APLICADO.
--
-- Pedido do dono: "ativar uma rotina de monitorar a campanha de forma super
-- inteligente, identificando o que está gastando sem resultado e pausando, e
-- também montando estratégias quando necessário, e só avisa quando fez tal
-- coisa; ai tem uma área do que foi feito, e tudo isso também automaticamente
-- atualizado no dossiê".
--
-- O que este SQL faz (só amplia, idempotente, pode rodar de novo):
--   1) public.ads_rotina: a rotina de cada cliente (ligada, teto diário de
--      verba, subida máxima por passo, ações por rodada e por dia, limites de
--      julgamento, regras do dono de "Interferir", o que viu, fez e planeja).
--   2) public.ads_rotina_acoes: "O que foi feito" (rotina e agente sênior):
--      o que fez, por quê, a prova (números com fonte e hora, estado lido na
--      Meta antes e depois, veredito do Jev), o resultado depois e o Desfazer.
--   3) RLS: a equipe com acesso ao cliente LÊ (is_staff + can_access_client,
--      a mesma regra das outras tabelas da Mesa Ads); só a função mesa-ads
--      (chave de serviço) escreve. can_access_client não muda.
--   4) Cron 'mesa-ads-rotina-trafego' a cada 20 min chamando a mesa-ads com
--      x-cron-secret e { acao: 'rotina_cron' }: até 2 clientes por chamada,
--      uma rodada por cliente por hora (a função controla). Sem cliente com a
--      rotina ligada, a chamada não faz nada.
--
-- O dossiê usa o caminho que já existe: cada ação feita grava uma linha em
-- project_memory (kind 'acao', interna) e chama dossie_enfileirar; o cron
-- dossie-fila-1min reescreve. Nenhum gatilho novo reescreve o dossiê.
--
-- Os avisos usam public.avisar_equipe_do_cliente (N-01), tipo 'update'.
-- Ensaio sem gravar: TR-01-rotina-trafego.dry.sql (mesmo conteúdo, termina
-- em ROLLBACK e mostra a conferência).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) A rotina de cada cliente ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_rotina (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ligada boolean NOT NULL DEFAULT false,
  teto_diario_brl numeric(12,2) CHECK (teto_diario_brl IS NULL OR teto_diario_brl > 0),
  subida_max_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (subida_max_pct BETWEEN 5 AND 30),
  max_acoes_rodada integer NOT NULL DEFAULT 3 CHECK (max_acoes_rodada BETWEEN 1 AND 10),
  max_acoes_dia integer NOT NULL DEFAULT 6 CHECK (max_acoes_dia BETWEEN 1 AND 30),
  limites jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limites) = 'object'),
  regras jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(regras) = 'array'),
  estado jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estado) = 'object'),
  ultima_rodada_em timestamptz,
  proxima_rodada_em timestamptz,
  -- Trava da rodada (duas rodadas do mesmo cliente nunca juntas; solta sozinha em 10 min).
  rodando_desde timestamptz,
  ligada_em timestamptz,
  ligada_por uuid,
  pausada_em timestamptz,
  pausada_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
CREATE INDEX IF NOT EXISTS ads_rotina_ligadas_idx ON public.ads_rotina (ultima_rodada_em NULLS FIRST) WHERE ligada;

COMMENT ON TABLE public.ads_rotina IS
  'Rotina de monitoramento do tráfego por cliente (frente TR, 27/09). Escrita só pela função mesa-ads; a equipe do cliente lê.';

-- ─── 2) O que foi feito ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_rotina_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rodada_id uuid,
  origem text NOT NULL CHECK (origem IN ('rotina', 'agente')),
  tipo text NOT NULL CHECK (tipo IN (
    'pausar', 'ativar', 'orcamento', 'renomear', 'duplicar_anuncio', 'trocar_criativo',
    'vincular_criativo', 'montar_campanha', 'ativar_campanha', 'proposta', 'parada'
  )),
  estado text NOT NULL CHECK (estado IN ('feita', 'falhou', 'proposta', 'desfeita', 'descartada')),
  alvo jsonb CHECK (alvo IS NULL OR jsonb_typeof(alvo) = 'object'),
  resumo text NOT NULL CHECK (length(resumo) BETWEEN 1 AND 600),
  porque text NOT NULL DEFAULT '' CHECK (length(porque) <= 2000),
  prova jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prova) = 'object'),
  resultado_depois jsonb,
  desfazer jsonb,
  mensagem_id uuid,
  item_id text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  desfeita_em timestamptz,
  desfeita_por uuid
);
CREATE INDEX IF NOT EXISTS ads_rotina_acoes_cliente_idx ON public.ads_rotina_acoes (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_rotina_acoes_recentes_idx ON public.ads_rotina_acoes (client_id, estado, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_rotina_acoes_mensagem_idx ON public.ads_rotina_acoes (mensagem_id, item_id) WHERE mensagem_id IS NOT NULL;

COMMENT ON TABLE public.ads_rotina_acoes IS
  'O que o agente de tráfego fez (rotina e agente sênior), com a prova e o Desfazer. Deletar = arquivar: nada é apagado, o estado muda.';

-- ─── 3) RLS e grants mínimos ─────────────────────────────────────────────
ALTER TABLE public.ads_rotina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_rotina_acoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_rotina, public.ads_rotina_acoes FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS ads_rotina_equipe_le ON public.ads_rotina;
CREATE POLICY ads_rotina_equipe_le ON public.ads_rotina FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_rotina_acoes_equipe_le ON public.ads_rotina_acoes;
CREATE POLICY ads_rotina_acoes_equipe_le ON public.ads_rotina_acoes FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_rotina, public.ads_rotina_acoes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ads_rotina, public.ads_rotina_acoes TO service_role;

-- ─── 4) Cron da rotina (a cada 20 min; a função decide quem roda) ──────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mesa-ads-rotina-trafego';
    PERFORM cron.schedule('mesa-ads-rotina-trafego', '7,27,47 * * * *', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-ads',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'rotina_cron'),
        timeout_milliseconds := 300000
      );
    $cron$);
  END IF;
END $$;

-- ─── Conferência (só leitura, depois de aplicar) ─────────────────────────
-- select to_regclass('public.ads_rotina') is not null as rotina_ok,
--        to_regclass('public.ads_rotina_acoes') is not null as acoes_ok,
--        (select count(*) from pg_policies where tablename in ('ads_rotina', 'ads_rotina_acoes')) as politicas, -- 2
--        (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_name = 'ads_rotina') as grants,
--        (select schedule from cron.job where jobname = 'mesa-ads-rotina-trafego') as cron;
-- Depois de publicar a função: ligar a rotina da agência na aba Conta e conferir
--   select ligada, ultima_rodada_em, estado->>'olhando', estado->>'bloqueio' from public.ads_rotina where client_id = '4dd691a7-d481-451f-800b-5e6b6fdc8721';
--
-- ─── Voltar atrás (se precisar) ──────────────────────────────────────────
-- select cron.unschedule(jobid) from cron.job where jobname = 'mesa-ads-rotina-trafego';
-- update public.ads_rotina set ligada = false;  -- para tudo sem perder o histórico
-- As tabelas podem ficar: sem elas a função responde "em preparação" e o agente sênior segue igual.
