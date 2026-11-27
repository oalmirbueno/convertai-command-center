-- 27/11/2026: dúvida do cliente que o assistente não sabe responder vai primeiro ao agente que pediu (ex.: Fred no OpenBot),
-- pela caixa do Escritório; sem resposta em 25 min vai ao Almir. Pedido do Almir: "o assistente consulta o Fred antes de chamar você".
ALTER TABLE public.intermediador_assuntos ADD COLUMN IF NOT EXISTS consulta jsonb;
ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_tipo_check;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_tipo_check
  CHECK (tipo IN ('pergunta', 'de_volta', 'lembrete', 'fechamento', 'humano', 'quem_e', 'aviso_dono', 'mencao', 'resposta', 'confirmando'));
