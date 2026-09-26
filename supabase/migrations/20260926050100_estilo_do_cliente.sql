-- Frente S2 (26/09/2026): estilo de design do cliente (agente de estilo).
-- Só amplia e é idempotente. RLS: equipe lê (is_staff + can_access_client);
-- só service_role escreve (a função agente-estilo confere o acesso antes).
-- Sem esta tabela o agente guarda o mesmo JSON no bucket mesa
-- (<cliente>/estilo/estilo-<marca|cliente>.json) e avisa; nada quebra.

CREATE TABLE IF NOT EXISTS public.cliente_estilos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Marca que não é a principal (Acerbi x CME); null = estilo do cliente.
  marca_id uuid NULL,
  ativo boolean NOT NULL DEFAULT false,
  versao_atual integer NOT NULL DEFAULT 0 CHECK (versao_atual >= 0),
  -- [{numero, guia:{resumo, regras:{layout,tipografia,cor,foto,elementos,capa,miolo,cta,evitar}, referencias:[...]}, origem, nota, criado_em, criado_por}]
  versoes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(versoes) = 'array'),
  -- [{id, tipo: gostou|nao_gostou, texto, em, por}]
  aprendizados jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aprendizados) = 'array'),
  -- [{id, caminho, tema, versao, custo_usd, criado_em, status, arquivo_id, imagem_id, referencia_id}]
  testes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(testes) = 'array'),
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- A marca é do mesmo cliente (mesma chave composta de cliente_referencias).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_estilos_marca_fk') THEN
    ALTER TABLE public.cliente_estilos
      ADD CONSTRAINT cliente_estilos_marca_fk FOREIGN KEY (marca_id, client_id)
      REFERENCES public.cliente_marcas (id, client_id) ON DELETE CASCADE;
  END IF;
END $$;

-- Um estilo por cliente e marca (null = o do cliente).
CREATE UNIQUE INDEX IF NOT EXISTS cliente_estilos_cliente_marca_uk
  ON public.cliente_estilos (client_id, coalesce(marca_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.cliente_estilos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cliente_estilos_staff_read ON public.cliente_estilos;
CREATE POLICY cliente_estilos_staff_read ON public.cliente_estilos
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
REVOKE ALL ON public.cliente_estilos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_estilos TO authenticated;
GRANT ALL ON public.cliente_estilos TO service_role;

COMMENT ON TABLE public.cliente_estilos IS
  'Estilo de design do cliente (agente de estilo, frente S2): guia versionado, aprendizados e testes. Complemento opcional do Estúdio; o kit da marca continua em cliente_kit_marca/cliente_marcas.';

-- Conferência (só leitura):
-- select id, client_id, marca_id, ativo, versao_atual, jsonb_array_length(versoes) from public.cliente_estilos;
