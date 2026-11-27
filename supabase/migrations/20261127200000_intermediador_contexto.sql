-- 27/11/2026: o agente que pede (ex.: Fred no OpenBot) manda junto o que já sabe do assunto.
-- Pedido do Almir: "a IA do OpenBot também, tipo o Fred entende com base no assunto". O escritor e o Jev usam isso
-- para não perguntar o óbvio e para responder dúvidas do cliente sobre o assunto.
ALTER TABLE public.intermediador_assuntos
  ADD COLUMN IF NOT EXISTS contexto text CHECK (contexto IS NULL OR char_length(contexto) BETWEEN 3 AND 1000);
