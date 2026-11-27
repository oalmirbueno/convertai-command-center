-- 27/11/2026: o assistente responde o cliente dentro do assunto (pergunta do cliente sobre o tema, respondida pelo contexto).
ALTER TABLE public.intermediador_envios DROP CONSTRAINT IF EXISTS intermediador_envios_tipo_check;
ALTER TABLE public.intermediador_envios ADD CONSTRAINT intermediador_envios_tipo_check
  CHECK (tipo IN ('pergunta', 'de_volta', 'lembrete', 'fechamento', 'humano', 'quem_e', 'aviso_dono', 'mencao', 'resposta'));
