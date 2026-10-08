-- Central de Autonomia (08/10/2026, etapa 2b): conversas do Gestor por cliente.
--
-- Só amplia e é idempotente. Nada muda em tasks, operator_*, agente_memoria
-- ou project_memory (o Gestor grava nelas pelas regras de sempre, na função).
--
-- 1. gestor_conversas: cada conversa tem dono, recorte (cliente e projeto,
--    ou a visão geral da Aceleriq quando client_id é nulo), título e um
--    resumo curto que vai ao modelo no lugar do histórico inteiro.
--    Arquivar é ocultar (arquivada_em); nada é apagado.
-- 2. gestor_mensagens.conversa_id: a mensagem pertence a uma conversa. As
--    mensagens antigas (sem conversa) entram numa conversa "Conversa
--    anterior" por dono, para o histórico continuar acessível.
-- Leitura: só o próprio admin. Escrita: só a função gestor-aceleriq.

CREATE TABLE IF NOT EXISTS public.gestor_conversas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id uuid NOT NULL,
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  titulo text NOT NULL DEFAULT 'Nova conversa',
  resumo text,
  arquivada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gestor_conversas_dono_atualizado_idx ON public.gestor_conversas (dono_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS gestor_conversas_cliente_idx ON public.gestor_conversas (client_id, atualizado_em DESC);

ALTER TABLE public.gestor_mensagens ADD COLUMN IF NOT EXISTS conversa_id uuid REFERENCES public.gestor_conversas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS gestor_mensagens_conversa_idx ON public.gestor_mensagens (conversa_id, criado_em);

-- Mensagens antigas: uma "Conversa anterior" por dono (recorte geral).
DO $migration$
DECLARE
  _dono uuid;
  _conversa uuid;
BEGIN
  FOR _dono IN SELECT DISTINCT dono_id FROM public.gestor_mensagens WHERE conversa_id IS NULL LOOP
    INSERT INTO public.gestor_conversas (dono_id, titulo, resumo, criado_em, atualizado_em)
    SELECT _dono, 'Conversa anterior', 'Mensagens de antes das conversas por cliente.', min(criado_em), max(criado_em)
      FROM public.gestor_mensagens WHERE dono_id = _dono AND conversa_id IS NULL
    RETURNING id INTO _conversa;
    UPDATE public.gestor_mensagens SET conversa_id = _conversa WHERE dono_id = _dono AND conversa_id IS NULL;
  END LOOP;
END
$migration$;

ALTER TABLE public.gestor_conversas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gestor_conversas_admin_le ON public.gestor_conversas;
CREATE POLICY gestor_conversas_admin_le
ON public.gestor_conversas
FOR SELECT TO authenticated
USING (public.has_role((select auth.uid()), 'admin'::public.app_role) AND dono_id = (select auth.uid()));

REVOKE ALL ON public.gestor_conversas FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.gestor_conversas FROM authenticated;
GRANT SELECT ON public.gestor_conversas TO authenticated;
GRANT ALL ON public.gestor_conversas TO service_role;
