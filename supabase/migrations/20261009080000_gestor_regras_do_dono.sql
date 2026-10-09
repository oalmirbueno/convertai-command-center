-- Regras que o dono ensina ao Gestor (09/10/2026).
--
-- Só amplia e é idempotente. Quando o Almir corrige ou ensina ("Ajenda não é mais cliente",
-- "os ativos são os mensalistas", "não me peça confirmação para consultar"), a regra fica aqui
-- e entra em toda conversa do Gestor, para ele não repetir o mesmo erro. Desativar não apaga.
-- Leitura e escrita: só o próprio dono (e o serviço).

CREATE TABLE IF NOT EXISTS public.gestor_regras_do_dono (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  texto text NOT NULL,
  origem text,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gestor_regras_do_dono_idx ON public.gestor_regras_do_dono (dono_id, ativa, criado_em);

ALTER TABLE public.gestor_regras_do_dono ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gestor_regras_do_dono_le ON public.gestor_regras_do_dono;
CREATE POLICY gestor_regras_do_dono_le ON public.gestor_regras_do_dono FOR SELECT TO authenticated USING (dono_id = auth.uid());
DROP POLICY IF EXISTS gestor_regras_do_dono_desativa ON public.gestor_regras_do_dono;
CREATE POLICY gestor_regras_do_dono_desativa ON public.gestor_regras_do_dono FOR UPDATE TO authenticated USING (dono_id = auth.uid()) WITH CHECK (dono_id = auth.uid());
DROP POLICY IF EXISTS gestor_regras_do_dono_servico ON public.gestor_regras_do_dono;
CREATE POLICY gestor_regras_do_dono_servico ON public.gestor_regras_do_dono FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, DELETE ON public.gestor_regras_do_dono FROM authenticated, anon;
