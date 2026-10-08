-- Central de Autonomia (08/10/2026): a conversa do dono com o Gestor Aceleriq.
--
-- Só amplia e é idempotente. Nada muda em tasks, operator_* ou aprovações.
--
-- gestor_mensagens guarda cada pergunta e cada resposta, com as fontes que a
-- resposta citou (dados.fontes: os mesmos fatos que a tela mostra como prova)
-- e o recorte usado (cliente e período). Conversa da agência, não de cliente:
-- client_id é só o recorte da pergunta (pode ser nulo = todos os clientes).
-- Leitura: só admin. Escrita: só a função gestor-aceleriq (chave de serviço),
-- depois de conferir que quem pergunta é admin. Sem UPDATE/DELETE pela API.

CREATE TABLE IF NOT EXISTS public.gestor_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id uuid NOT NULL,
  papel text NOT NULL,
  conteudo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_id uuid,
  uso_id uuid,
  custo_usd numeric(10, 4) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gestor_mensagens_papel_check') THEN
    ALTER TABLE public.gestor_mensagens
      ADD CONSTRAINT gestor_mensagens_papel_check CHECK (papel IN ('usuario', 'gestor', 'sistema'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gestor_mensagens_dados_check') THEN
    ALTER TABLE public.gestor_mensagens
      ADD CONSTRAINT gestor_mensagens_dados_check CHECK (jsonb_typeof(dados) = 'object');
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS gestor_mensagens_dono_criado_idx ON public.gestor_mensagens (dono_id, criado_em DESC);

ALTER TABLE public.gestor_mensagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gestor_mensagens_admin_le ON public.gestor_mensagens;
CREATE POLICY gestor_mensagens_admin_le
ON public.gestor_mensagens
FOR SELECT TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role) AND dono_id = (select auth.uid()));

REVOKE ALL ON public.gestor_mensagens FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.gestor_mensagens FROM authenticated;
GRANT SELECT ON public.gestor_mensagens TO authenticated;
GRANT ALL ON public.gestor_mensagens TO service_role;
