-- Frente V2 (25/09 à noite): ponte de DADOS entre a Mesa Roteiros (R2) e a Mesa Vídeos.
-- Aplicar DEPOIS do R2-mesa-roteiros.sql. Sem a tabela public.roteiros, não faz nada.
--
-- A Mesa Vídeos lê só esta view (contrato em supabase/functions/_shared/roteiros-para-video.ts):
--   id, client_id, titulo, aprovado_em, cenas = [{ ref, ordem, titulo, fala, visual }]
-- Cada cena é um bloco da versão APROVADA do roteiro (versoes[].conteudo.blocos, onde
-- numero = versao_aprovada). ref = id do bloco (estável entre versões na Mesa Roteiros).
-- Nenhum código da Mesa Roteiros é usado; se o formato das versões mudar, só esta view muda.
--
-- security_invoker: quem lê passa pela RLS de public.roteiros (equipe com acesso ao cliente).

DO $do$
BEGIN
  IF to_regclass('public.roteiros') IS NULL THEN
    RAISE NOTICE 'public.roteiros ainda não existe: aplique o R2-mesa-roteiros.sql antes.';
    RETURN;
  END IF;

  EXECUTE $v$
    CREATE OR REPLACE VIEW public.roteiros_aprovados_para_video
    WITH (security_invoker = true) AS
    SELECT
      r.id,
      r.client_id,
      r.titulo,
      r.aprovado_em,
      coalesce((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'ref', coalesce(nullif(b.bloco ->> 'id', ''), 'bloco-' || b.i),
                   'ordem', CASE WHEN (b.bloco ->> 'ordem') ~ '^[0-9]{1,4}$' THEN (b.bloco ->> 'ordem')::int ELSE b.i::int END,
                   'titulo', coalesce(b.bloco ->> 'funcao', ''),
                   'fala', b.bloco ->> 'fala',
                   'visual', b.bloco ->> 'visual'
                 )
                 ORDER BY b.i
               )
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(v.conteudo -> 'blocos') = 'array' THEN v.conteudo -> 'blocos' ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS b(bloco, i)
      ), '[]'::jsonb) AS cenas
    FROM public.roteiros r
    CROSS JOIN LATERAL (
      SELECT e -> 'conteudo' AS conteudo
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.versoes) = 'array' THEN r.versoes ELSE '[]'::jsonb END) AS e
      WHERE (e ->> 'numero') ~ '^[0-9]{1,6}$' AND (e ->> 'numero')::int = r.versao_aprovada
      LIMIT 1
    ) v
    WHERE r.status IN ('aprovado', 'gravado')
      AND r.versao_aprovada IS NOT NULL
      AND r.arquivado_em IS NULL
  $v$;

  EXECUTE 'COMMENT ON VIEW public.roteiros_aprovados_para_video IS ''Roteiros aprovados (versão aprovada) em cenas, para a Mesa Vídeos. Só leitura; RLS de roteiros.''';
  EXECUTE 'REVOKE ALL ON public.roteiros_aprovados_para_video FROM anon';
  EXECUTE 'GRANT SELECT ON public.roteiros_aprovados_para_video TO authenticated, service_role';
END
$do$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select id, titulo, jsonb_array_length(cenas) from public.roteiros_aprovados_para_video limit 10;
