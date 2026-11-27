-- 27/11/2026: o Intermediador entende quando alguém marca o assistente no grupo e manda mensagens picadas.
-- Pedido do Almir: "ele entender quando eu marco ou o cliente marca e poder falar com o cliente e atualizar a base
-- conforme marcação, ser mais humano, e mandar mensagens picadas e não tudo no mesmo".
--
-- intermediador_mencoes  cada mensagem que marcou o assistente (uma linha por mensagem, nunca tratada duas vezes)
-- intermediador_envios   passa a aceitar envio de uma menção (sem assunto) e guarda o id de cada parte enviada

CREATE TABLE IF NOT EXISTS public.intermediador_mencoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL UNIQUE,
  client_id uuid NOT NULL,
  group_id text NOT NULL,
  grupo_nome text NOT NULL,
  autor_papel text NOT NULL,
  autor_numero text,
  autor_nome text,
  texto text,
  ocorreu_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'nova' CHECK (estado IN ('nova', 'feita', 'nada', 'segurada', 'antiga')),
  intencao text,
  notas jsonb NOT NULL DEFAULT '{}'::jsonb,
  feito jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo text,
  tentativas integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intermediador_mencoes_estado ON public.intermediador_mencoes (estado, ocorreu_em);

ALTER TABLE public.intermediador_mencoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intermediador_mencoes_equipe_le ON public.intermediador_mencoes;
CREATE POLICY intermediador_mencoes_equipe_le ON public.intermediador_mencoes FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
REVOKE ALL ON public.intermediador_mencoes FROM anon;
GRANT SELECT ON public.intermediador_mencoes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intermediador_mencoes TO service_role;

-- Envio de uma menção não tem assunto: leva o próprio grupo.
ALTER TABLE public.intermediador_envios ALTER COLUMN assunto_id DROP NOT NULL;
ALTER TABLE public.intermediador_envios
  ADD COLUMN IF NOT EXISTS mencao_id uuid REFERENCES public.intermediador_mencoes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS group_id text,
  ADD COLUMN IF NOT EXISTS grupo_nome text,
  ADD COLUMN IF NOT EXISTS message_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_dono_do_envio;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_dono_do_envio
  CHECK (assunto_id IS NOT NULL OR (mencao_id IS NOT NULL AND group_id IS NOT NULL AND grupo_nome IS NOT NULL AND client_id IS NOT NULL));
ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_tipo_check;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_tipo_check
  CHECK (tipo IN ('pergunta', 'de_volta', 'lembrete', 'fechamento', 'humano', 'quem_e', 'aviso_dono', 'mencao'));
ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_texto_check;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_texto_check CHECK (char_length(texto) BETWEEN 2 AND 1500);
CREATE UNIQUE INDEX IF NOT EXISTS intermediador_envios_um_por_mencao ON public.intermediador_envios (mencao_id, tipo) WHERE mencao_id IS NOT NULL;

-- Mensagens dos grupos lidos que marcaram o assistente (pelo telefone ou pelo id interno do WhatsApp).
CREATE OR REPLACE FUNCTION public.intermediador_mencoes_novas(p_desde timestamptz, p_marcas text[])
RETURNS TABLE (
  id text, client_id uuid, group_id text, rotulo text, remetente text, remetente_nome text, papel text, tipo text,
  texto text, transcricao text, transcricao_status text, descricao_midia text, occurred_at timestamptz, received_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.provider_message_id, g.client_id, m.group_id, g.rotulo, m.remetente, m.remetente_nome, m.papel, m.tipo,
         m.texto, m.transcricao, m.transcricao_status, m.descricao_midia, m.occurred_at, m.received_at
    FROM acq_n8n.mensagens_entrada m
    JOIN acq_n8n.grupos_cliente g ON g.group_id = m.group_id AND g.leitura_liberada IS TRUE
   WHERE m.received_at > p_desde
     AND m.papel IS DISTINCT FROM 'bot'
     AND EXISTS (SELECT 1 FROM unnest(p_marcas) k WHERE coalesce(m.texto, '') LIKE '%@' || k || '%' OR coalesce(m.transcricao, '') LIKE '%@' || k || '%')
     AND NOT EXISTS (SELECT 1 FROM public.intermediador_mencoes x WHERE x.provider_message_id = m.provider_message_id)
   ORDER BY m.received_at
   LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.intermediador_mencoes_novas(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intermediador_mencoes_novas(timestamptz, text[]) TO service_role;
