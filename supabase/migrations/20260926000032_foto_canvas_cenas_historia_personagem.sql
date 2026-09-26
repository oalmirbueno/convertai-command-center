-- Frente V (25/09 à noite): cenas, história e personagem persistente no Canvas da Mesa Foto.
ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_origem_valida;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_origem_valida CHECK (origem IN ('sintetica', 'clone_de_foto_real', 'personagem'));

COMMENT ON COLUMN public.foto_modelos.origem IS
  'sintetica (aba Modelos), clone_de_foto_real (aba Clones, com autorização) ou personagem (pessoa gerada numa cena do Canvas; sintética, âncora = a foto da cena).';

ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_ficha_valida;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_ficha_valida CHECK (
    jsonb_typeof(ficha) = 'object'
    AND jsonb_typeof(ficha -> 'idade_aparente') = 'number'
    AND (
      (origem = 'clone_de_foto_real' AND (ficha ->> 'idade_aparente')::numeric >= 18)
      OR (ficha ->> 'idade_aparente')::numeric >= 21
    )
  );

ALTER TABLE public.foto_modelos DROP CONSTRAINT IF EXISTS foto_modelos_etica_valida;
ALTER TABLE public.foto_modelos
  ADD CONSTRAINT foto_modelos_etica_valida CHECK (
    jsonb_typeof(etica) = 'object'
    AND (etica ->> 'adulta') = 'true'
    AND (
      (origem IN ('sintetica', 'personagem') AND (etica ->> 'sintetica') = 'true' AND (etica ->> 'sem_semelhanca') = 'true')
      OR (origem = 'clone_de_foto_real' AND (etica ->> 'clone_de_pessoa_real') = 'true' AND (etica ->> 'autorizada') = 'true')
    )
  );

UPDATE public.foto_modelos
   SET origem = 'personagem'
 WHERE origem = 'sintetica'
   AND coalesce(ficha ->> 'notas', '') LIKE 'Personagem do Canvas%';

ALTER TABLE public.foto_canvas ADD COLUMN IF NOT EXISTS historia jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foto_canvas_historia_objeto') THEN
    ALTER TABLE public.foto_canvas
      ADD CONSTRAINT foto_canvas_historia_objeto CHECK (historia IS NULL OR jsonb_typeof(historia) = 'object');
  END IF;
END $$;
COMMENT ON COLUMN public.foto_canvas.historia IS
  '{ sinopse, formato, animacao (reservado para a Mesa Vídeos) }. As cenas moram nos nós (tipo saida, dados.cena); a ordem é dados.cena.ordem.';

CREATE OR REPLACE VIEW public.foto_cenas_da_historia
WITH (security_invoker = true) AS
SELECT
  c.id AS canvas_id,
  c.client_id,
  c.nome AS canvas_nome,
  c.historia,
  n.no ->> 'id' AS no_id,
  row_number() OVER (
    PARTITION BY c.id
    ORDER BY coalesce((n.no -> 'dados' -> 'cena' ->> 'ordem')::numeric, 999),
             coalesce((n.no ->> 'y')::numeric, 0),
             coalesce((n.no ->> 'x')::numeric, 0),
             n.no ->> 'id'
  ) AS numero,
  n.no -> 'dados' -> 'cena' ->> 'titulo' AS titulo,
  n.no -> 'dados' -> 'cena' ->> 'acao' AS acao,
  n.no -> 'dados' -> 'cena' ->> 'enquadramento' AS enquadramento,
  n.no -> 'dados' -> 'cena' ->> 'cenario' AS cenario,
  n.no -> 'dados' -> 'cena' ->> 'narrativa' AS narrativa,
  CASE WHEN (n.no -> 'dados' -> 'cena' ->> 'imagem_id') ~ '^[0-9a-f-]{36}$'
       THEN (n.no -> 'dados' -> 'cena' ->> 'imagem_id')::uuid END AS imagem_id,
  n.no -> 'dados' -> 'cena' -> 'animacao' AS animacao,
  n.no -> 'dados' -> 'resultados' AS resultados,
  c.atualizado_em
FROM public.foto_canvas c
CROSS JOIN LATERAL jsonb_array_elements(c.nos) AS n(no)
WHERE c.status = 'ativo'
  AND n.no ->> 'tipo' = 'saida'
  AND jsonb_typeof(n.no -> 'dados' -> 'cena') = 'object';

COMMENT ON VIEW public.foto_cenas_da_historia IS
  'Cenas da história de cada canvas ativo, na ordem (Mesa Vídeos lê daqui ou do canvas). imagem_id nulo = a mais nova do Resultado. Só leitura; RLS de foto_canvas.';

REVOKE ALL ON public.foto_cenas_da_historia FROM anon;
GRANT SELECT ON public.foto_cenas_da_historia TO authenticated, service_role;
