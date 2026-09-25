-- Mesa do cliente: papel "estrategista_rapido" no catálogo de modelos (25/09/2026).
-- Fonte: docs/mesa/migrations/20260925150000_mesa_modelo_rapido.sql. Só libera o papel na
-- restrição de padrao_para; nada muda até alguém marcar um modelo com ele (o conteúdo rápido
-- usa o padrão do estrategista com raciocínio baixo enquanto isso).

ALTER TABLE public.ia_modelos DROP CONSTRAINT IF EXISTS ia_modelos_padrao_para_check;
ALTER TABLE public.ia_modelos
  ADD CONSTRAINT ia_modelos_padrao_para_check
  CHECK (padrao_para <@ ARRAY['estrategista', 'diretor_arte', 'imagem', 'leitura', 'contexto', 'estrategista_rapido']::text[]);