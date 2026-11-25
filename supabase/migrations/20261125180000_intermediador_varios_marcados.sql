-- 25/11/2026: o Intermediador marca a pessoa certa do cliente ou todas as pessoas do cliente no grupo.
-- Pedido do Almir: "importante sempre marcar o nome do membro do grupo referente ou todos".
-- marcar_numero e marcar_nome continuam guardando a primeira pessoa (compatível com o que já existe).
ALTER TABLE public.intermediador_assuntos
  ADD COLUMN IF NOT EXISTS marcar_numeros text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS marcar_nomes text[] NOT NULL DEFAULT '{}';

UPDATE public.intermediador_assuntos
   SET marcar_numeros = ARRAY[marcar_numero], marcar_nomes = ARRAY[coalesce(marcar_nome, '')]
 WHERE cardinality(marcar_numeros) = 0;

ALTER TABLE public.intermediador_assuntos DROP CONSTRAINT IF EXISTS intermediador_marcar_numeros_ok;
ALTER TABLE public.intermediador_assuntos
  ADD CONSTRAINT intermediador_marcar_numeros_ok
  CHECK (cardinality(marcar_numeros) BETWEEN 1 AND 6 AND array_to_string(marcar_numeros, ',') ~ '^[0-9]{10,16}(,[0-9]{10,16})*$');
