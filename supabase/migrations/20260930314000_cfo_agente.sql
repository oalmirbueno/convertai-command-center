-- Frente CFO (30/09/2026): o agente financeiro (CFO) no Assist e em Financeiro › CFO.
--
-- Só amplia e é idempotente. Nada muda nas tabelas do financeiro (billing, expenses,
-- financial_*), em can_access_client nem nas guardas de arquivo. Nada é apagado.
--
-- 1. cfo_mensagens: a conversa do dono com o CFO. É da agência (não de cliente), por isso
--    não usa agente_mensagens (client_id obrigatório lá). A proposta do agente (lançar,
--    cortar, meta) mora em `anexos`, no contrato comum _shared/acoes-do-agente.ts.
--    Leitura: só admin. Escrita: só a função agente-cfo (chave de serviço), depois de
--    conferir que quem pede é admin.
-- 2. cfo_metas: as metas do plano de crescimento que o dono confirmou. Apagar = arquivar.
--    Leitura: só admin. Escrita: só a função agente-cfo.
-- 3. cfo_eventos: o registro da trava. Toda vez que um gasto passa do limite do mês e o
--    dono decide (lançar mesmo assim ou desistir), fica aqui. O CFO usa isso para dizer
--    "você passou do limite N vezes neste mês". Leitura: só admin. Inserção: o próprio
--    admin (criado_por = ele) ou a função. Sem UPDATE nem DELETE pela API.
--
-- O financeiro é só do admin (régua de FinanceV2 e das abas admin do Financeiro).

-- ---------------------------------------------------------------------------
-- 1. Conversa
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cfo_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id uuid NOT NULL,
  papel text NOT NULL,
  conteudo text NOT NULL,
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb,
  uso_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_mensagens_papel_check') THEN
    ALTER TABLE public.cfo_mensagens
      ADD CONSTRAINT cfo_mensagens_papel_check CHECK (papel IN ('usuario', 'agente', 'sistema'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_mensagens_anexos_check') THEN
    ALTER TABLE public.cfo_mensagens
      ADD CONSTRAINT cfo_mensagens_anexos_check CHECK (jsonb_typeof(anexos) = 'array');
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS cfo_mensagens_dono_criado_idx ON public.cfo_mensagens (dono_id, criado_em DESC);

ALTER TABLE public.cfo_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfo_mensagens_admin_le ON public.cfo_mensagens;
CREATE POLICY cfo_mensagens_admin_le
ON public.cfo_mensagens
FOR SELECT TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

REVOKE INSERT, UPDATE, DELETE ON public.cfo_mensagens FROM anon, authenticated;
GRANT SELECT ON public.cfo_mensagens TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Metas do plano de crescimento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cfo_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  tipo text NOT NULL DEFAULT 'outra',
  valor_alvo numeric(12, 2) NOT NULL,
  valor_base numeric(12, 2),
  prazo date,
  como text,
  origem text NOT NULL DEFAULT 'cfo',
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_metas_tipo_check') THEN
    ALTER TABLE public.cfo_metas
      ADD CONSTRAINT cfo_metas_tipo_check CHECK (tipo IN ('equilibrio', 'reserva', 'meta_mensal', 'receita_mensal', 'pro_labore', 'corte', 'outra'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_metas_valor_check') THEN
    ALTER TABLE public.cfo_metas
      ADD CONSTRAINT cfo_metas_valor_check CHECK (valor_alvo > 0);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS cfo_metas_abertas_idx ON public.cfo_metas (criado_em DESC) WHERE arquivado_em IS NULL;

ALTER TABLE public.cfo_metas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfo_metas_admin_le ON public.cfo_metas;
CREATE POLICY cfo_metas_admin_le
ON public.cfo_metas
FOR SELECT TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

REVOKE INSERT, UPDATE, DELETE ON public.cfo_metas FROM anon, authenticated;
GRANT SELECT ON public.cfo_metas TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Registro da trava
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cfo_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  valor numeric(12, 2) NOT NULL,
  limite numeric(12, 2),
  recorrente boolean NOT NULL DEFAULT false,
  descricao text,
  origem text NOT NULL DEFAULT 'painel',
  decisao text NOT NULL,
  criado_por uuid NOT NULL DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_eventos_tipo_check') THEN
    ALTER TABLE public.cfo_eventos
      ADD CONSTRAINT cfo_eventos_tipo_check CHECK (tipo IN ('gasto_acima_do_limite', 'gasto_em_atencao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_eventos_decisao_check') THEN
    ALTER TABLE public.cfo_eventos
      ADD CONSTRAINT cfo_eventos_decisao_check CHECK (decisao IN ('lancou', 'desistiu'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_eventos_origem_check') THEN
    ALTER TABLE public.cfo_eventos
      ADD CONSTRAINT cfo_eventos_origem_check CHECK (origem IN ('painel', 'caixa', 'custos_fixos', 'cfo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_eventos_valor_check') THEN
    ALTER TABLE public.cfo_eventos
      ADD CONSTRAINT cfo_eventos_valor_check CHECK (valor >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cfo_eventos_descricao_check') THEN
    ALTER TABLE public.cfo_eventos
      ADD CONSTRAINT cfo_eventos_descricao_check CHECK (descricao IS NULL OR length(descricao) <= 300);
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS cfo_eventos_criado_idx ON public.cfo_eventos (criado_em DESC);

ALTER TABLE public.cfo_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfo_eventos_admin_le ON public.cfo_eventos;
CREATE POLICY cfo_eventos_admin_le
ON public.cfo_eventos
FOR SELECT TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS cfo_eventos_admin_registra ON public.cfo_eventos;
CREATE POLICY cfo_eventos_admin_registra
ON public.cfo_eventos
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role((select auth.uid()), 'admin'::public.app_role)
  AND criado_por = (select auth.uid())
);

REVOKE UPDATE, DELETE ON public.cfo_eventos FROM anon, authenticated;
GRANT SELECT, INSERT ON public.cfo_eventos TO authenticated;
