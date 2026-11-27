-- 27/11/2026: o Intermediador aguenta a IA do painel sem crédito (OpenRouter 402 desde as 8h).
-- 1) Marcação que não pôde ser tratada porque o escritor não respondeu volta a ser lida 15 min depois (até 8 vezes).
-- 2) Aviso ao dono pode sair sem assunto nem menção (ex.: "a IA do painel parou de responder").

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
     AND NOT EXISTS (
       SELECT 1 FROM public.intermediador_mencoes x
        WHERE x.provider_message_id = m.provider_message_id
          AND NOT (x.estado = 'nova' AND x.tentativas < 8 AND x.atualizado_em < now() - interval '15 minutes'))
   ORDER BY m.received_at
   LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.intermediador_mencoes_novas(timestamptz, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intermediador_mencoes_novas(timestamptz, text[]) TO service_role;

ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_dono_do_envio;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_dono_do_envio
  CHECK (assunto_id IS NOT NULL OR destino = 'dono'
         OR (mencao_id IS NOT NULL AND group_id IS NOT NULL AND grupo_nome IS NOT NULL AND client_id IS NOT NULL));
