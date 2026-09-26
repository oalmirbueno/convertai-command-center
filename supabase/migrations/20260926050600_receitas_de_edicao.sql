-- Frente V-B (26/09): editor de vídeo da Mesa Edição.
-- Só amplia, idempotente. Uma tabela nova: video_receitas (templates de edição
-- tirados de vídeos de referência, por cliente e da agência).
-- RLS: equipe lê (is_staff + can_access_client; template da agência, client_id
-- nulo, qualquer pessoa da equipe lê); só a service_role escreve (função editor-video).
--
-- Sem este SQL:
--   * o editor abre e funciona inteiro (o projeto, as referências e as receitas
--     ficam no projeto de edição, video_versoes.projeto, do SQL E2-01);
--   * "Salvar como template" avisa que falta o SQL V-B-01 e a lista de
--     templates fica vazia.
-- Nada aqui mexe em ia_usos: o editor registra uso com tarefa/agente que já
-- existem (conversa/diretor_arte, leitura_referencia/leitor).

CREATE TABLE IF NOT EXISTS public.video_receitas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  origem jsonb NOT NULL DEFAULT '{}'::jsonb,
  receita jsonb NOT NULL,
  criado_por uuid NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  arquivada_em timestamptz NULL,
  CONSTRAINT video_receitas_receita_tamanho CHECK (pg_column_size(receita) <= 200000)
);

CREATE INDEX IF NOT EXISTS video_receitas_cliente_idx ON public.video_receitas (client_id, criado_em DESC) WHERE arquivada_em IS NULL;

ALTER TABLE public.video_receitas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_receitas_staff_read ON public.video_receitas;
CREATE POLICY video_receitas_staff_read ON public.video_receitas
  FOR SELECT TO authenticated
  USING (
    public.is_staff((select auth.uid()))
    AND (client_id IS NULL OR public.can_access_client(client_id))
  );

REVOKE ALL ON public.video_receitas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.video_receitas TO authenticated;
GRANT ALL ON public.video_receitas TO service_role;

COMMENT ON TABLE public.video_receitas IS 'Receitas de edição (templates) tiradas de vídeos de referência. Frente V-B. Só a edição (ritmo, cortes, legenda), nunca o conteúdo da referência.';
