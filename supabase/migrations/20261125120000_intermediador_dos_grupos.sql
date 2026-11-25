-- 25/11/2026: Intermediador dos grupos de cliente.
--
-- Pedido do Almir: um número (o 3429, que já está nos grupos) com um agente que conversa com o cliente
-- no grupo SÓ quando outro agente precisa perguntar algo, marcando a pessoa, dentro de um tema, e devolve a
-- resposta ao agente que pediu. Não responde ao resto do grupo.
--
-- Peças:
--   intermediador_assuntos  um pedido de um agente (tema, pergunta, quem marcar, o que conta como resposta)
--   intermediador_envios    cada texto que o processo do VPS precisa mandar (ao grupo ou, em prévia, ao dono)
--   intermediador_eventos   o rastro de tudo (mensagem ouvida, ignorada, nota do Jev, decisão)
--   intermediador_pessoas_do_grupo / intermediador_mensagens  leitura do que o leitor dos grupos já grava
--                                                              em acq_n8n.mensagens_entrada (só service_role)
-- O agente "intermediador" entra no cadastro para aparecer no Escritório e assinar as respostas.

CREATE TABLE IF NOT EXISTS public.intermediador_assuntos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  group_id text NOT NULL,
  grupo_nome text NOT NULL,
  tema text NOT NULL CHECK (char_length(tema) BETWEEN 3 AND 120),
  pergunta text NOT NULL CHECK (char_length(pergunta) BETWEEN 8 AND 400),
  marcar_numero text NOT NULL CHECK (marcar_numero ~ '^[0-9]{10,16}$'),
  marcar_nome text,
  o_que_conta jsonb NOT NULL CHECK (jsonb_typeof(o_que_conta) = 'array' AND jsonb_array_length(o_que_conta) BETWEEN 1 AND 4),
  pode_perguntar_de_volta boolean NOT NULL DEFAULT true,
  prazo_horas integer NOT NULL DEFAULT 24 CHECK (prazo_horas BETWEEN 2 AND 72),
  pedido_por text NOT NULL,
  responder_para text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'na_fila' CHECK (estado IN (
    'na_fila', 'perguntando', 'esperando', 'lembrado',
    'respondido', 'respondido_em_parte', 'vencido', 'precisa_do_almir', 'cancelado', 'previa')),
  pergunta_msg_id text,
  perguntado_em timestamptz,
  vence_em timestamptz,
  lido_ate timestamptz,
  envios_ao_cliente integer NOT NULL DEFAULT 0,
  perguntou_de_volta boolean NOT NULL DEFAULT false,
  itens jsonb NOT NULL DEFAULT '{}'::jsonb,
  ouvidas jsonb NOT NULL DEFAULT '[]'::jsonb,
  resposta jsonb,
  motivo text,
  devolvido_em timestamptz,
  fechado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Um assunto aberto por grupo de cada vez: os outros esperam na fila.
CREATE UNIQUE INDEX IF NOT EXISTS intermediador_um_aberto_por_grupo
  ON public.intermediador_assuntos (group_id)
  WHERE estado IN ('perguntando', 'esperando', 'lembrado');
CREATE INDEX IF NOT EXISTS intermediador_assuntos_estado ON public.intermediador_assuntos (estado, criado_em);
CREATE INDEX IF NOT EXISTS intermediador_assuntos_cliente ON public.intermediador_assuntos (client_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.intermediador_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assunto_id uuid NOT NULL REFERENCES public.intermediador_assuntos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('pergunta', 'de_volta', 'lembrete', 'fechamento', 'humano', 'quem_e', 'aviso_dono')),
  destino text NOT NULL CHECK (destino IN ('grupo', 'dono')),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 10 AND 1500),
  texto_previa text NOT NULL,
  mencoes text[] NOT NULL DEFAULT '{}',
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'enviado', 'previa', 'incerto', 'cancelado')),
  message_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  feito_em timestamptz,
  UNIQUE (assunto_id, tipo)
);
CREATE INDEX IF NOT EXISTS intermediador_envios_pendentes ON public.intermediador_envios (criado_em) WHERE estado = 'pendente';

CREATE TABLE IF NOT EXISTS public.intermediador_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assunto_id uuid REFERENCES public.intermediador_assuntos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intermediador_eventos_assunto ON public.intermediador_eventos (assunto_id, em);

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['intermediador_assuntos', 'intermediador_envios', 'intermediador_eventos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_equipe_le', _t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())))', _t || '_equipe_le', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', _t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', _t);
  END LOOP;
END $$;

-- O grupo do cliente que o leitor lê (sem ele, o intermediador não escuta a resposta).
CREATE OR REPLACE FUNCTION public.intermediador_grupo_do_cliente(p_client_id uuid)
RETURNS TABLE (group_id text, rotulo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT g.group_id, g.rotulo
    FROM acq_n8n.grupos_cliente g
   WHERE g.client_id = p_client_id AND g.leitura_liberada IS TRUE
   ORDER BY g.aprovado_em DESC NULLS LAST
   LIMIT 1;
$$;

-- Quem do cliente fala no grupo (últimos 60 dias), mais ativo primeiro. O número nunca sai do servidor.
CREATE OR REPLACE FUNCTION public.intermediador_pessoas_do_grupo(p_client_id uuid)
RETURNS TABLE (numero text, nome text, mensagens bigint, ultima timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.remetente, max(m.remetente_nome), count(*), max(m.occurred_at)
    FROM acq_n8n.mensagens_entrada m
   WHERE m.client_id = p_client_id
     AND m.papel LIKE 'cliente%'
     AND m.remetente ~ '^[0-9]{10,16}$'
     AND m.occurred_at > now() - interval '60 days'
   GROUP BY m.remetente
   ORDER BY count(*) DESC, max(m.occurred_at) DESC;
$$;

-- Mensagens do grupo que chegaram depois de um momento (o processo filtra quem é ouvido).
CREATE OR REPLACE FUNCTION public.intermediador_mensagens(p_group_id text, p_desde timestamptz)
RETURNS TABLE (
  id text, remetente text, remetente_nome text, papel text, tipo text, texto text,
  transcricao text, transcricao_status text, descricao_midia text, resposta_a text,
  occurred_at timestamptz, received_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.provider_message_id, m.remetente, m.remetente_nome, m.papel, m.tipo, m.texto,
         m.transcricao, m.transcricao_status, m.descricao_midia, m.resposta_a, m.occurred_at, m.received_at
    FROM acq_n8n.mensagens_entrada m
   WHERE m.group_id = p_group_id
     AND m.received_at > p_desde
   ORDER BY m.received_at
   LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.intermediador_grupo_do_cliente(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.intermediador_pessoas_do_grupo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.intermediador_mensagens(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intermediador_grupo_do_cliente(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.intermediador_pessoas_do_grupo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.intermediador_mensagens(text, timestamptz) TO service_role;

-- O agente no cadastro (aparece no Escritório; as respostas aos agentes saem assinadas por ele).
INSERT INTO public.internal_operators (slug, display_name, role, scope, hermes_profile_ref, status, area, parent_slug, origem, grau)
VALUES ('intermediador', 'Intermediador dos grupos',
        'Pergunta ao cliente no grupo de WhatsApp quando um agente precisa de um dado, marca a pessoa, escuta só a resposta daquele tema e devolve ao agente pelo Escritório. Peça com aceleriq_intermediador_pedir.',
        'Fala com o cliente só no grupo dele, só sobre o tema que um agente pediu, só com a pessoa marcada, com textos fixos e no máximo 3 mensagens por assunto. Não promete preço, prazo nem desconto, não publica, não mexe em anúncio nem financeiro; o que for decisão vai ao Almir.',
        'vps:/opt/aceleriq-intermediador',
        'active', 'Clientes', 'helena', 'hermes', 'executor')
ON CONFLICT (slug) DO NOTHING;
