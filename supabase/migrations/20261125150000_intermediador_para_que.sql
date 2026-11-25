-- 25/11/2026: o pedido ao Intermediador pode dizer para que o time precisa do dado ("para o post de fim de ano").
-- O escritor usa isso em poucas palavras, para a pergunta soar como conversa e não como formulário.
ALTER TABLE public.intermediador_assuntos
  ADD COLUMN IF NOT EXISTS para_que text CHECK (para_que IS NULL OR char_length(para_que) BETWEEN 3 AND 160);
