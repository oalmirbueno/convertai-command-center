-- Frente T (26/09/2026): templates de design e referências de carrossel (agente de estilo).
-- NÃO APLICADO. Só amplia e é idempotente.
-- RLS no padrão das tabelas cliente_* recentes: a equipe lê (is_staff + can_access_client);
-- o template da agência (escopo agencia, sem cliente) é lido por toda a equipe;
-- só service_role escreve (a função agente-estilo confere o acesso antes).
-- Sem esta tabela o agente guarda o mesmo JSON no bucket mesa
-- (<cliente>/estilo/templates.json e _agencia/estilo/templates.json) e avisa; nada quebra.

CREATE TABLE IF NOT EXISTS public.cliente_templates_design (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- template: molde em regras. referencia_carrossel: carrossel guardado lâmina a lâmina, na ordem.
  tipo text NOT NULL DEFAULT 'template' CHECK (tipo IN ('template', 'referencia_carrossel')),
  escopo text NOT NULL DEFAULT 'cliente' CHECK (escopo IN ('cliente', 'agencia')),
  client_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Marca que não é a principal (Acerbi x CME); null = do cliente todo.
  marca_id uuid NULL,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 80),
  formato text NOT NULL DEFAULT 'post' CHECK (formato IN ('post', 'carrossel', 'story', 'anuncio')),
  -- Apagar é arquivar.
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado')),
  origem text NOT NULL DEFAULT 'equipe' CHECK (origem IN ('agente', 'equipe', 'combinacao', 'referencias', 'perfil', 'artes_aprovadas')),
  versao_atual integer NOT NULL DEFAULT 0 CHECK (versao_atual >= 0),
  -- [{numero, corpo:{resumo, formato, regras, areas, continuidade, ancoras, laminas_referencia}, origem, nota, criado_em, criado_por, de_onde}]
  versoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(versoes) = 'array'),
  -- [{id, quem: cliente|dono, tipo: gostou|nao_gostou, texto, em, por}]
  gostos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gostos) = 'array'),
  -- [{id, caminho, tema, versao, custo_usd, criado_em, status}]
  testes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(testes) = 'array'),
  -- ids dos templates de onde este nasceu (combinação)
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fontes) = 'array'),
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- Do cliente: tem cliente. Da agência: sem cliente e sem marca.
  CONSTRAINT cliente_templates_design_dono_ck CHECK (
    (escopo = 'cliente' AND client_id IS NOT NULL) OR (escopo = 'agencia' AND client_id IS NULL AND marca_id IS NULL)
  )
);

-- A marca é do mesmo cliente (mesma chave composta de cliente_referencias e cliente_estilos).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_templates_design_marca_fk') THEN
    ALTER TABLE public.cliente_templates_design
      ADD CONSTRAINT cliente_templates_design_marca_fk FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cliente_templates_design_cliente_idx
  ON public.cliente_templates_design (client_id, status, atualizado_em DESC) WHERE escopo = 'cliente';
CREATE INDEX IF NOT EXISTS cliente_templates_design_agencia_idx
  ON public.cliente_templates_design (status, atualizado_em DESC) WHERE escopo = 'agencia';

ALTER TABLE public.cliente_templates_design ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cliente_templates_design_staff_read ON public.cliente_templates_design;
CREATE POLICY cliente_templates_design_staff_read ON public.cliente_templates_design
  FOR SELECT TO authenticated
  USING (
    public.is_staff((select auth.uid()))
    AND (escopo = 'agencia' OR public.can_access_client(client_id))
  );
REVOKE ALL ON public.cliente_templates_design FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_templates_design TO authenticated;
GRANT ALL ON public.cliente_templates_design TO service_role;

COMMENT ON TABLE public.cliente_templates_design IS
  'Templates de design e referências de carrossel (agente de estilo, frente T): molde versionado, gostos, testes e âncoras. Complemento opcional do Estúdio; só entra na geração quando escolhido no trabalho (direcao.template_de_design). Kit da marca continua em cliente_kit_marca/cliente_marcas.';

-- Conferência (só leitura):
-- select id, tipo, escopo, client_id, nome, formato, status, versao_atual, jsonb_array_length(versoes) from public.cliente_templates_design order by atualizado_em desc;
