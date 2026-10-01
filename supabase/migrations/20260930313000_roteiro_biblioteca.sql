-- Frente ROT (30/09): biblioteca "Roteiros validados" da Mesa Roteiros.
-- Só amplia e é idempotente (pode rodar mais de uma vez). Não mexe em dado existente.
--
-- Os modelos validados (os do material Roteiros Mágicos e os da casa) moram
-- no código (supabase/functions/mesa-roteiros/modulos/roteiros-validados.ts).
-- Esta tabela guarda só os modelos PRÓPRIOS que o dono acrescenta para outros
-- nichos (advogado, conteúdo direto...), na mesma forma (a ficha): da agência
-- (valem para todos os clientes) ou de um cliente.
--
-- RLS: equipe lê com is_staff e, no modelo de cliente, can_access_client.
-- Só service_role escreve (a função mesa-roteiros confere o acesso).
-- Apagar = arquivar (arquivado_em). Sem esta migração a mesa abre, a base
-- validada funciona e a parte "Meus modelos" avisa que o banco não guarda.

CREATE TABLE IF NOT EXISTS public.roteiro_biblioteca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo text NOT NULL DEFAULT 'agencia' CHECK (escopo IN ('agencia', 'cliente')),
  client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  objetivo text NOT NULL DEFAULT 'autoridade' CHECK (objetivo IN ('autoridade', 'produto', 'presenca_de_marca', 'venda', 'conexao', 'engajamento')),
  ficha jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ficha) = 'object'),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  arquivado_em timestamptz,
  arquivado_por uuid,
  CONSTRAINT roteiro_biblioteca_escopo_cliente CHECK (
    (escopo = 'cliente' AND client_id IS NOT NULL) OR (escopo = 'agencia' AND client_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS roteiro_biblioteca_agencia_idx ON public.roteiro_biblioteca (criado_em DESC) WHERE escopo = 'agencia' AND arquivado_em IS NULL;
CREATE INDEX IF NOT EXISTS roteiro_biblioteca_cliente_idx ON public.roteiro_biblioteca (client_id, criado_em DESC) WHERE arquivado_em IS NULL;

-- atualizado_em sozinho (a função já existe desde a Mesa Roteiros; criada aqui se faltar).
CREATE OR REPLACE FUNCTION public.mesa_tocar_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roteiro_biblioteca_tocar_atualizado_em ON public.roteiro_biblioteca;
CREATE TRIGGER roteiro_biblioteca_tocar_atualizado_em
BEFORE UPDATE ON public.roteiro_biblioteca
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

ALTER TABLE public.roteiro_biblioteca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roteiro_biblioteca_equipe_le ON public.roteiro_biblioteca;
CREATE POLICY roteiro_biblioteca_equipe_le ON public.roteiro_biblioteca
  FOR SELECT TO authenticated
  USING (
    public.is_staff((select auth.uid()))
    AND (
      (escopo = 'agencia' AND client_id IS NULL)
      OR (escopo = 'cliente' AND public.can_access_client(client_id))
    )
  );

REVOKE ALL ON public.roteiro_biblioteca FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.roteiro_biblioteca FROM authenticated;
GRANT SELECT ON public.roteiro_biblioteca TO authenticated;
GRANT ALL ON public.roteiro_biblioteca TO service_role;

NOTIFY pgrst, 'reload schema';
