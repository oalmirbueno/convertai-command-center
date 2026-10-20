-- Laboratório (20/10/2026, "nós inteligentes"): configuração do projeto.
--
-- lab_projetos.config (jsonb, objeto). Hoje só { auto_ate_usd: número de 0 a 5 }: o teto que o dono (admin ou
-- gestor) autoriza para os nós com dados.auto rodarem sozinhos no no_executar { automatico: true }, sem a
-- confirmação de custo. Padrão {} = 0 = nada roda sozinho. A função confere tudo de novo (supabase/functions/
-- laboratorio/acoes.ts e modulos/inteligencia.ts); o CHECK aqui é a última trava.
--
-- Idempotente e só amplia. Nada é apagado.

ALTER TABLE public.lab_projetos ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.lab_projetos DROP CONSTRAINT IF EXISTS lab_projetos_config_check;
ALTER TABLE public.lab_projetos
  ADD CONSTRAINT lab_projetos_config_check CHECK (
    jsonb_typeof(config) = 'object'
    AND CASE
      WHEN NOT (config ? 'auto_ate_usd') THEN true
      WHEN jsonb_typeof(config -> 'auto_ate_usd') <> 'number' THEN false
      ELSE (config ->> 'auto_ate_usd')::numeric BETWEEN 0 AND 5
    END
  );

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select count(*) from public.lab_projetos where config <> '{}'::jsonb;  -- 0 logo depois
