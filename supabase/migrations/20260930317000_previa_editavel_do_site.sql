-- Frente SPV (30/09/2026): prévia editável do site durante a construção.
-- Regras puras: supabase/functions/mesa-site/modulos/site-previa.ts; rotas: mesa-site/previa.ts.
--
-- 1) motor_trabalhos ganha o tipo "conteudo": levar ao projeto do worker o
--    pacote novo depois de uma edição de conteúdo feita na prévia (texto da
--    copy, imagem, cor, fonte, esconder ou mover seção). É máquina: sem
--    modelo, sem teto, sem custo. Só amplia a CHECK.
-- 2) site_edicoes: o histórico das edições da prévia, com o antes e o depois
--    de cada ponto (Desfazer exato) ou o trabalho "ajustar" que a edição
--    virou. Nada é apagado: desfazer marca desfeita_em.
-- 3) Os trabalhos que já estavam na fila antes desta entrega ganham em
--    resultado as seções pedidas (secoes_pedidas no construir, secao_pedida
--    no ajustar), copiadas do pedido: a prévia marca "Na fila do motor" em vez
--    de "Ainda não construída". Só acrescenta a chave que falta.
--
-- RLS: a equipe com acesso ao cliente lê (forma de conjunto, a mesma regra do
-- can_access_client, como na 20260930296200); só a service_role escreve (a
-- função mesa-site confere acesso e marca antes). Idempotente.
-- Não aplicar direto: o dono aplica na integração (SQL Editor).

SET LOCAL lock_timeout = '5s';

-- ─── 1) Tipo "conteudo" na fila do motor ────────────────────────────────────

ALTER TABLE public.motor_trabalhos DROP CONSTRAINT IF EXISTS motor_trabalhos_tipo_check;
ALTER TABLE public.motor_trabalhos
  ADD CONSTRAINT motor_trabalhos_tipo_check
  CHECK (tipo IN ('construir', 'ajustar', 'desfazer', 'revisar', 'publicar', 'zip', 'conteudo'));

-- ─── 2) Histórico das edições da prévia ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_edicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('texto', 'texto_livre', 'imagem', 'cor', 'fonte', 'secao_visivel', 'secao_mover', 'pedido')),
  modo text NOT NULL CHECK (modo IN ('direto', 'ajuste')),
  resumo text NOT NULL CHECK (char_length(resumo) BETWEEN 1 AND 300),
  secao text CHECK (secao IS NULL OR secao ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  alvos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(alvos) = 'array'),
  edicao jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(edicao) = 'object'),
  trabalho_id uuid REFERENCES public.motor_trabalhos(id) ON DELETE SET NULL,
  desfeita_em timestamptz,
  desfeita_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_edicoes_site_idx ON public.site_edicoes (site_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS site_edicoes_cliente_idx ON public.site_edicoes (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS site_edicoes_trabalho_idx ON public.site_edicoes (trabalho_id) WHERE trabalho_id IS NOT NULL;

ALTER TABLE public.site_edicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_edicoes_staff_read ON public.site_edicoes;
CREATE POLICY site_edicoes_staff_read ON public.site_edicoes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff((SELECT auth.uid())))
    AND (
      (SELECT app_private.eh_admin_atual())
      OR client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[])
    )
  );

REVOKE ALL ON public.site_edicoes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.site_edicoes FROM authenticated;
GRANT SELECT ON public.site_edicoes TO authenticated;
GRANT ALL ON public.site_edicoes TO service_role;

COMMENT ON TABLE public.site_edicoes IS
  'SPV 30/09: edições feitas na prévia do site (Mesa Site, etapa Construção). direto = conteúdo aplicado na hora, com antes/depois por ponto em alvos (Desfazer exato); ajuste = virou trabalho "ajustar" do motor (trabalho_id). Escrita só pela função mesa-site (service_role).';

-- ─── 3) Seções pedidas nos trabalhos que já estavam abertos ─────────────────

UPDATE public.motor_trabalhos
   SET resultado = resultado || jsonb_build_object('secoes_pedidas', pedido -> 'secoes')
 WHERE tipo = 'construir'
   AND estado IN ('na_fila', 'executando', 'parando')
   AND NOT (resultado ? 'secoes_pedidas')
   AND jsonb_typeof(pedido -> 'secoes') = 'array';

UPDATE public.motor_trabalhos
   SET resultado = resultado || jsonb_build_object('secao_pedida', pedido -> 'secao')
 WHERE tipo = 'ajustar'
   AND estado IN ('na_fila', 'executando', 'parando')
   AND NOT (resultado ? 'secao_pedida')
   AND jsonb_typeof(pedido -> 'secao') = 'string';

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'motor_trabalhos_tipo_check';
-- select policyname, qual from pg_policies where tablename = 'site_edicoes';
-- select count(*) from public.site_edicoes;
-- select id, tipo, estado, resultado -> 'secoes_pedidas' from public.motor_trabalhos where estado in ('na_fila', 'executando', 'parando');
