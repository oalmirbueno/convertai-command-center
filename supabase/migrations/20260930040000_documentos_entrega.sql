-- Frente DOC (29/09/2026): Registro da entrega (documento padrão de entrega ao cliente).
-- Função: supabase/functions/documentos. Modelo e PDF: supabase/functions/_shared/registro-de-entrega.ts.
--
-- Uma linha por entrega documentada (cliente + tipo + referência): o gancho das
-- mesas cria a linha "pendente" sem custo; gerar monta o PDF só com eventos reais,
-- guarda em Arquivos (pasta entregas) e liga aqui. Gerar de novo sobe a versão e
-- cria um arquivo novo (o anterior fica em Arquivos). O envio ao cliente é o fluxo
-- de aprovação que já existe (admin_release_file_now), sempre com Confirmar na tela.
--
-- Só amplia, idempotente. RLS: a equipe lê (is_staff + can_access_client); só a
-- service_role escreve (tudo passa pela função documentos). Apagar = arquivar.

CREATE TABLE IF NOT EXISTS public.documentos_entrega (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marca_id uuid NULL,
  tipo text NOT NULL,
  referencia text NOT NULL,
  titulo text NULL,
  numero integer NULL,
  versao integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  file_id uuid NULL REFERENCES public.files(id) ON DELETE SET NULL,
  -- O registro montado (sem imagens): resumo, itens, provas, números, fontes, código.
  conteudo jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- O que a mesa mandou no gancho (resumo curto e ids de arquivos de prova).
  gancho jsonb NOT NULL DEFAULT '{}'::jsonb,
  avisos text[] NOT NULL DEFAULT '{}'::text[],
  custo_usd numeric NOT NULL DEFAULT 0,
  pedido_por uuid NULL,
  gerado_por uuid NULL,
  gerado_em timestamptz NULL,
  liberado_por uuid NULL,
  liberado_em timestamptz NULL,
  arquivado_em timestamptz NULL,
  arquivado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_tipo_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_tipo_check
      CHECK (tipo IN ('mes_de_pautas', 'projeto', 'periodo'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_status_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_status_check
      CHECK (status IN ('pendente', 'gerado', 'em_aprovacao', 'no_portal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_referencia_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_referencia_check
      CHECK (length(referencia) BETWEEN 7 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_conteudo_objeto') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_conteudo_objeto
      CHECK (jsonb_typeof(conteudo) = 'object' AND jsonb_typeof(gancho) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documentos_entrega_versao_check') THEN
    ALTER TABLE public.documentos_entrega ADD CONSTRAINT documentos_entrega_versao_check
      CHECK (versao >= 0 AND (numero IS NULL OR numero > 0) AND custo_usd >= 0);
  END IF;
END $$;

-- Uma entrega, um registro (o gancho é idempotente); número sequencial por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS documentos_entrega_uma_por_entrega
  ON public.documentos_entrega (client_id, tipo, referencia);
CREATE UNIQUE INDEX IF NOT EXISTS documentos_entrega_numero_por_cliente
  ON public.documentos_entrega (client_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS documentos_entrega_cliente_recentes
  ON public.documentos_entrega (client_id, criado_em DESC) WHERE arquivado_em IS NULL;
CREATE INDEX IF NOT EXISTS documentos_entrega_arquivo
  ON public.documentos_entrega (file_id) WHERE file_id IS NOT NULL;

ALTER TABLE public.documentos_entrega ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documentos_entrega_equipe_le ON public.documentos_entrega;
CREATE POLICY documentos_entrega_equipe_le ON public.documentos_entrega
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.documentos_entrega FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.documentos_entrega FROM authenticated;
GRANT SELECT ON public.documentos_entrega TO authenticated;
GRANT ALL ON public.documentos_entrega TO service_role;

COMMENT ON TABLE public.documentos_entrega IS
  'Frente DOC (29/09/2026): registro da entrega por cliente/tipo/referência. Escrita só pela função documentos (service_role).';
