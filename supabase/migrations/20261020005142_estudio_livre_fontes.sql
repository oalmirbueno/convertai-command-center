-- 20/10/2026 (dono: "está muito burro, sendo que ele é avulso; não dar o erro de tipografia"): a arte do
-- Estúdio livre escolhe um par de fontes da biblioteca da agência pelo pedido e o grava aqui, para todas as
-- lâminas da série usarem a mesma letra (estudio-arte/modulos/fontes-do-livre.ts).
ALTER TABLE public.estudio_livre_trabalhos ADD COLUMN IF NOT EXISTS fontes jsonb;
