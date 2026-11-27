-- 27/11/2026: escritor de reserva do Intermediador.
-- Pedido do Almir: "temos que ter algo se caso acabar o OpenRouter, uma segunda solução, pra não parar".
-- Quando o motor do painel (OpenRouter) não responde, o pedido de escrita entra aqui; o processo do VPS escreve
-- com o Codex (conta do ChatGPT, sem custo por mensagem), devolve com aceleriq_intermediador_escrita_feita e a
-- rodada seguinte usa o texto, que passa pelas mesmas conferências de sempre.

CREATE TABLE IF NOT EXISTS public.intermediador_escritas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  referencia text,
  sistema text NOT NULL,
  usuario text NOT NULL,
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'feita', 'falhou')),
  texto text,
  motivo text,
  quem_escreveu text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  feito_em timestamptz
);
CREATE INDEX IF NOT EXISTS intermediador_escritas_pendentes ON public.intermediador_escritas (criado_em) WHERE estado = 'pendente';

ALTER TABLE public.intermediador_escritas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intermediador_escritas_equipe_le ON public.intermediador_escritas;
CREATE POLICY intermediador_escritas_equipe_le ON public.intermediador_escritas FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())));
REVOKE ALL ON public.intermediador_escritas FROM anon;
GRANT SELECT ON public.intermediador_escritas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intermediador_escritas TO service_role;
