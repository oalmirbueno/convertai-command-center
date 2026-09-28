-- ═══════════════════════════════════════════════════════════════════════
-- AD-01 · GERENCIADOR AO VIVO E AÇÕES DA EQUIPE (frente AD, 28/09). NÃO APLICADO.
--
-- Pedido do dono: "abrir a telinha do gerenciador de anúncios dentro do
-- painel ... monitorar em tempo real" e "essas informações têm que chegar à
-- Central". O que este SQL faz (só amplia, idempotente, pode rodar de novo):
--
--   1) public.ads_gerenciador_leituras: cada leitura do Gerenciador ao vivo
--      (mesa-ads, ação gerenciador_ler) com a hora, o período, a fonte
--      (meta_ao_vivo, misto ou coleta), a situação de cada conta (ativa ou
--      travada, com o motivo), o resumo (campanhas ativas e entregando, gasto
--      de hoje, alertas) e a árvore enxuta (campanha, conjunto, anúncio com a
--      entrega e os números). A função grava uma a cada 10 min por cliente e
--      toda leitura forçada ("Atualizar agora").
--   2) public.ads_gerenciador_atual: a última leitura de cada cliente (view
--      com security_invoker: vale a RLS de quem lê). É o que a Central lê.
--   3) public.ads_rotina_acoes aceita origem 'equipe' (ação feita por alguém
--      da equipe pelo Gerenciador, com a prova e o Desfazer, ao lado das do
--      agente e da rotina). Sem este passo a função grava origem 'agente' com
--      prova.pela_equipe = true, e a tela lê as duas formas.
--   4) RLS: a equipe com acesso ao cliente LÊ (is_staff + can_access_client,
--      a mesma regra da TR-01); só a função (chave de serviço) escreve.
--      can_access_client não muda.
--
-- Para a frente CE (Central) ler:
--   select client_id, lido_em, fonte, periodo_inicio, periodo_fim, contas, resumo, avisos
--     from public.ads_gerenciador_atual where client_id = :cliente;
--   select criado_em, origem, tipo, estado, alvo->>'nome' as item, resumo, porque,
--          prova->'antes' as antes, prova->'depois' as depois, prova->>'relido_na_meta_em' as relido_em
--     from public.ads_rotina_acoes where client_id = :cliente order by criado_em desc limit 20;
--   (estado: feita, falhou, desfeita, proposta, descartada; origem: agente, rotina, equipe)
--
-- Ensaio sem gravar: AD-01-gerenciador-ao-vivo.dry.sql (termina em ROLLBACK).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Leituras do Gerenciador ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ads_gerenciador_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plataforma text NOT NULL DEFAULT 'meta' CHECK (plataforma IN ('meta', 'google', 'tiktok')),
  fonte text NOT NULL CHECK (fonte IN ('meta_ao_vivo', 'misto', 'coleta')),
  lido_em timestamptz NOT NULL,
  sincronizado_em timestamptz,
  periodo_inicio date,
  periodo_fim date,
  dias integer CHECK (dias IS NULL OR dias BETWEEN 1 AND 180),
  contas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contas) = 'array'),
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(resumo) = 'object'),
  arvore jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(arvore) = 'array'),
  gestao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(gestao) = 'object'),
  avisos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(avisos) = 'array'),
  forcada boolean NOT NULL DEFAULT false,
  lido_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_gerenciador_leituras_cliente_idx ON public.ads_gerenciador_leituras (client_id, lido_em DESC);

COMMENT ON TABLE public.ads_gerenciador_leituras IS
  'Leituras do Gerenciador ao vivo da Mesa Ads (frente AD, 28/09): situação da conta, resumo e árvore com a entrega real. Escrita só pela função mesa-ads; a equipe do cliente lê. A Central lê a última pela view ads_gerenciador_atual.';

-- ─── 2) A última leitura de cada cliente (para a Central) ─────────────────
CREATE OR REPLACE VIEW public.ads_gerenciador_atual
WITH (security_invoker = true) AS
SELECT DISTINCT ON (client_id)
  id, client_id, plataforma, fonte, lido_em, sincronizado_em, periodo_inicio, periodo_fim, dias, contas, resumo, arvore, gestao, avisos
FROM public.ads_gerenciador_leituras
ORDER BY client_id, lido_em DESC;

COMMENT ON VIEW public.ads_gerenciador_atual IS
  'Última leitura do Gerenciador ao vivo por cliente (security_invoker: vale a RLS de ads_gerenciador_leituras).';

-- ─── 3) Ação da equipe em "O que foi feito" ──────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.ads_rotina_acoes') IS NOT NULL THEN
    ALTER TABLE public.ads_rotina_acoes DROP CONSTRAINT IF EXISTS ads_rotina_acoes_origem_check;
    ALTER TABLE public.ads_rotina_acoes ADD CONSTRAINT ads_rotina_acoes_origem_check CHECK (origem IN ('rotina', 'agente', 'equipe'));
  END IF;
END $$;

-- ─── 4) RLS e grants mínimos ─────────────────────────────────────────────
ALTER TABLE public.ads_gerenciador_leituras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_gerenciador_leituras FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ads_gerenciador_atual FROM PUBLIC, anon;

DROP POLICY IF EXISTS ads_gerenciador_leituras_equipe_le ON public.ads_gerenciador_leituras;
CREATE POLICY ads_gerenciador_leituras_equipe_le ON public.ads_gerenciador_leituras FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_gerenciador_leituras TO authenticated;
GRANT SELECT, INSERT ON public.ads_gerenciador_leituras TO service_role;
GRANT SELECT ON public.ads_gerenciador_atual TO authenticated, service_role;

-- ─── Conferência (só leitura, depois de aplicar) ─────────────────────────
-- select to_regclass('public.ads_gerenciador_leituras') is not null as tabela_ok,
--        to_regclass('public.ads_gerenciador_atual') is not null as view_ok,
--        (select count(*) from pg_policies where tablename = 'ads_gerenciador_leituras') as politicas, -- 1
--        (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ads_rotina_acoes_origem_check') as origem;
-- Depois de publicar a função e abrir a aba Conta da agência:
--   select lido_em, fonte, resumo->>'campanhas_entregando', contas->0->'situacao'->>'rotulo' from public.ads_gerenciador_atual
--    where client_id = '4dd691a7-d481-451f-800b-5e6b6fdc8721';
--
-- ─── Voltar atrás (se precisar) ──────────────────────────────────────────
-- drop view if exists public.ads_gerenciador_atual;
-- drop table if exists public.ads_gerenciador_leituras;   -- só leituras; nada de conta se perde
-- (a origem 'equipe' pode ficar: a função cai para 'agente' sozinha se a regra voltar)
