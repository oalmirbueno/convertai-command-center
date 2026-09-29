-- Contratos por modelo (frente CON, 30/09/2026): modelos como dados.
--
-- contrato_modelos: as condições gerais e os blocos por serviço, com versão.
-- contrato_clausulas: as cláusulas de cada versão, com {{variáveis}} e a
-- condição de quando entram (variantes de silêncio, portfólio, IA, direitos).
--
-- Versão é imutável: mudar texto é publicar uma versão nova (novas linhas) e
-- desligar a anterior. O contrato guarda a versão que usou; o congelado não
-- depende mais do modelo (o texto inteiro fica no contrato, com o hash).
-- Leitura: só a equipe. Escrita: só o servidor (service_role).
-- Idempotente e só amplia.

CREATE TABLE IF NOT EXISTS public.contrato_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL,
  tipo text NOT NULL,
  servico text,
  nome text NOT NULL,
  versao integer NOT NULL,
  revisao_juridica text NOT NULL DEFAULT 'v1 · revisão jurídica pendente',
  variaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  CONSTRAINT contrato_modelos_tipo_check CHECK (tipo IN ('condicoes_gerais', 'bloco')),
  CONSTRAINT contrato_modelos_servico_check CHECK (
    (tipo = 'condicoes_gerais' AND servico IS NULL)
    OR (tipo = 'bloco' AND servico IN ('social', 'site', 'marca', 'naming', 'trafego', 'video', 'design', 'mensalista'))
  ),
  CONSTRAINT contrato_modelos_versao_check CHECK (versao >= 1),
  CONSTRAINT contrato_modelos_variaveis_check CHECK (jsonb_typeof(variaveis) = 'array'),
  CONSTRAINT contrato_modelos_chave_versao_key UNIQUE (chave, versao)
);

CREATE UNIQUE INDEX IF NOT EXISTS contrato_modelos_um_ativo_idx
  ON public.contrato_modelos (chave) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.contrato_clausulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL REFERENCES public.contrato_modelos(id) ON DELETE RESTRICT,
  ordem integer NOT NULL,
  chave text NOT NULL,
  titulo text NOT NULL,
  texto text NOT NULL,
  quando jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contrato_clausulas_modelo_chave_key UNIQUE (modelo_id, chave),
  CONSTRAINT contrato_clausulas_texto_check CHECK (length(btrim(texto)) > 0)
);

CREATE INDEX IF NOT EXISTS contrato_clausulas_modelo_ordem_idx
  ON public.contrato_clausulas (modelo_id, ordem);

-- Versão publicada não muda: só ligar/desligar o modelo.
CREATE OR REPLACE FUNCTION public.contrato_modelo_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'contrato_clausulas' THEN
    RAISE EXCEPTION 'cláusula publicada não muda: publique uma versão nova do modelo';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'modelo publicado não é apagado: desligue a versão';
  END IF;
  IF NEW.chave IS DISTINCT FROM OLD.chave
    OR NEW.tipo IS DISTINCT FROM OLD.tipo
    OR NEW.servico IS DISTINCT FROM OLD.servico
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.variaveis IS DISTINCT FROM OLD.variaveis
    OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'modelo publicado não muda: publique uma versão nova';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS contrato_modelos_imutavel_trg ON public.contrato_modelos;
CREATE TRIGGER contrato_modelos_imutavel_trg
  BEFORE UPDATE OR DELETE ON public.contrato_modelos
  FOR EACH ROW EXECUTE FUNCTION public.contrato_modelo_imutavel();

DROP TRIGGER IF EXISTS contrato_clausulas_imutavel_trg ON public.contrato_clausulas;
CREATE TRIGGER contrato_clausulas_imutavel_trg
  BEFORE UPDATE OR DELETE ON public.contrato_clausulas
  FOR EACH ROW EXECUTE FUNCTION public.contrato_modelo_imutavel();

ALTER TABLE public.contrato_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrato_clausulas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.contrato_modelos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.contrato_clausulas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contrato_modelos TO authenticated;
GRANT SELECT ON public.contrato_clausulas TO authenticated;
GRANT ALL ON public.contrato_modelos TO service_role;
GRANT ALL ON public.contrato_clausulas TO service_role;

DROP POLICY IF EXISTS contrato_modelos_equipe_le ON public.contrato_modelos;
CREATE POLICY contrato_modelos_equipe_le ON public.contrato_modelos
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS contrato_clausulas_equipe_le ON public.contrato_clausulas;
CREATE POLICY contrato_clausulas_equipe_le ON public.contrato_clausulas
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

COMMENT ON TABLE public.contrato_modelos IS 'Modelos de contrato (condições gerais e blocos por serviço) com versão. Frente CON, 30/09/2026.';
COMMENT ON COLUMN public.contrato_modelos.revisao_juridica IS 'Marca interna da revisão jurídica (ex.: v1 · revisão jurídica pendente). Só a equipe vê; nunca vai ao documento do cliente.';
